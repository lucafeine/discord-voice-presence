/**
 * Discord RPC OAuth2 authorization flow.
 *
 * Why it is required: without authorization, the Discord client exposes only
 * the `rpc.local` commands (the current user's profile). Every voice-related
 * command returns `RPC 4006 Not authenticated or invalid scope`. A single
 * authorization with the `rpc` scope unlocks the full set.
 *
 * ## PKCE, without any secret
 *
 * The plugin neither embeds nor stores a `client_secret`: the flow uses PKCE
 * (S256) with the `client_id` alone, which is public by nature.
 *
 * This requires ONE checkbox in the developer portal:
 *
 *   your application -> OAuth2 -> Public Client -> enable -> Save Changes
 *
 * Without it, the code exchange returns `HTTP 401 invalid_client`, which looks
 * like an RPC flow incompatibility but is not. It is the main pitfall of this
 * configuration.
 *
 * ## The redirect_uri must be registered, but never sent
 *
 * The RPC OAuth2 flow rejects any `redirect_uri` in the AUTHORIZE request
 * ("Redirect URI cannot be used in the RPC OAuth2 Authorization flow") while
 * requiring one to be registered on the application so Discord can use a
 * default value (otherwise: "Missing redirect_uri in request"). Configure it
 * once: OAuth2 -> Redirects -> any URI, in first position.
 *
 * ## Order of operations
 *
 *   AUTHORIZE -> code -> PKCE exchange -> access_token -> AUTHENTICATE
 *
 * Depending on the case, Discord may already authenticate the connection when
 * the user approves: AUTHENTICATE then returns `RPC 4002 Already authenticated`,
 * which is not an error.
 *
 * Reference: https://docs.discord.food/topics/oauth2
 */

import crypto from "node:crypto";
import { log } from "./log.js";
import type { DiscordIpc } from "./ipc.js";

const TOKEN_URL = "https://discord.com/api/oauth2/token";

/** Time left to the user to accept the request in Discord. */
const AUTHORIZE_TIMEOUT_MS = 180_000;

/** Margin before expiry: refresh slightly before the real deadline. */
const EXPIRY_MARGIN_MS = 60_000;

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
  /** Expiry date, as epoch milliseconds. */
  expires_at: number;
}

interface TokenEndpointResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
}

export interface AuthOptions {
  /** Identifiant public de l'application. Aucun secret n'est necessaire. */
  clientId: string;
  scopes: string[];
}

/**
 * Where tokens are stored.
 *
 * The prototype wrote a file; the plugin uses Stream Deck global settings. The
 * abstraction keeps the authorization logic independent of either mechanism.
 */
export interface TokenStore {
  load(): Promise<TokenSet | null>;
  save(tokens: TokenSet): Promise<void>;
  /** Clears the stored authorization so a new one can be requested. */
  clear(): Promise<void>;
}

// --- PKCE --------------------------------------------------------------------

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// --- Appels HTTP -------------------------------------------------------------

async function requestToken(body: URLSearchParams): Promise<TokenSet> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Token exchange failed (HTTP ${response.status}): ${text}`);
  }

  const payload = JSON.parse(text) as TokenEndpointResponse;
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type,
    scope: payload.scope,
    expires_at: Date.now() + payload.expires_in * 1000,
  };
}

// --- Flux complet ------------------------------------------------------------

/**
 * Turns opaque Discord errors into actionable instructions.
 *
 * The two common failures in this configuration are `invalid_client` (Public
 * Client not enabled) and `Missing redirect_uri` (no redirect URI registered).
 */
function explainAuthorizeFailure(error: unknown, clientId: string): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("redirect_uri")) {
    return [
      message,
      "",
      "The Discord RPC OAuth2 flow does not accept a redirect_uri in the request,",
      "but it requires a URI to be REGISTERED on the application (Discord uses the",
      "first one in the list by default).",
      "",
      "Do this once in the developer portal:",
      "  1. your application -> OAuth2 -> Redirects",
      "  2. add a URI, for example: http://localhost",
      "  3. move it to the FIRST position, then Save Changes",
      `      https://discord.com/developers/applications/${clientId}/oauth2`,
    ].join("\n");
  }

  return message;
}

/**
 * Asks the user for authorization, then exchanges the code with PKCE.
 *
 * Discord displays a consent window: this function waits for the user to
 * approve it.
 */
export async function authorize(ipc: DiscordIpc, options: AuthOptions): Promise<TokenSet> {
  const pkce = createPkcePair();

  log.info(`Requested scopes: ${options.scopes.join(", ")}`);
  log.info("PKCE flow (S256): no client_secret is used.");
  log.warn("An authorization window will open in Discord: accept it to continue.");

  let code: string;
  try {
    const result = await ipc.call<{ code: string }>(
      "AUTHORIZE",
      {
        client_id: options.clientId,
        scopes: options.scopes,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      },
      AUTHORIZE_TIMEOUT_MS,
    );

    if (typeof result?.code !== "string") {
      throw new Error(`Unexpected AUTHORIZE response: ${JSON.stringify(result)}`);
    }
    code = result.code;
  } catch (error) {
    throw new Error(explainAuthorizeFailure(error, options.clientId));
  }

  log.ok("Authorization code received.");

  let tokens: TokenSet;
  try {
    tokens = await requestToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: options.clientId,
        code_verifier: pkce.verifier,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("invalid_client")) {
      throw new Error(
        [
          message,
          "",
          "The application does not accept public clients. Enable this once:",
          "  your application -> OAuth2 -> Public Client -> enable -> Save Changes",
          `  https://discord.com/developers/applications/${options.clientId}/oauth2`,
          "",
          "This setting is what allows PKCE, and therefore the absence of a client_secret.",
        ].join("\n"),
      );
    }
    throw error;
  }

  log.ok(`Authorization granted (scopes: ${tokens.scope}).`);
  return tokens;
}

/** Refreshes an expired token. No secret here either. */
export async function refresh(
  tokens: TokenSet,
  options: Pick<AuthOptions, "clientId">,
): Promise<TokenSet> {
  log.info("Refreshing token...");
  const refreshed = await requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: options.clientId,
    }),
  );
  log.ok("Token refreshed.");
  return refreshed;
}

/**
 * Associates the IPC connection with the access token.
 *
 * `RPC 4002 Already authenticated` means the authorization flow already
 * authenticated the connection: this is not a failure.
 */
export async function authenticate(ipc: DiscordIpc, accessToken: string): Promise<string> {
  const result = await ipc.call<{ scopes?: string[] }>("AUTHENTICATE", {
    access_token: accessToken,
  });
  return (result?.scopes ?? []).join(" ");
}

function isAlreadyAuthenticated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Already authenticated") || message.includes("4002");
}

export function isExpired(tokens: TokenSet): boolean {
  return Date.now() >= tokens.expires_at - EXPIRY_MARGIN_MS;
}

// --- Persistence -------------------------------------------------------------

/** Checks that an object read from settings looks like a valid token set. */
export function isTokenSet(value: unknown): value is TokenSet {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<TokenSet>;
  return typeof candidate.access_token === "string" && typeof candidate.refresh_token === "string";
}

/** Authenticates the connection, tolerating the already-authenticated case. */
export async function applyToken(ipc: DiscordIpc, tokens: TokenSet): Promise<void> {
  try {
    const scopes = await authenticate(ipc, tokens.access_token);
    log.ok(`Connected to the Discord RPC (scopes: ${scopes}).`);
  } catch (error) {
    if (isAlreadyAuthenticated(error)) {
      log.ok("Connection already authenticated by the authorization.");
      return;
    }
    throw error;
  }
}

/**
 * Ensures an authorized IPC connection: reuses the stored token, refreshes it
 * when needed, otherwise starts the consent flow.
 */
export async function ensureAuthenticated(
  ipc: DiscordIpc,
  store: TokenStore,
  options: AuthOptions,
): Promise<TokenSet> {
  let tokens = await store.load();

  if (tokens !== null) {
    if (isExpired(tokens)) {
      try {
        tokens = await refresh(tokens, options);
        await store.save(tokens);
      } catch (error) {
        log.warn(`Refresh failed: ${(error as Error).message}`);
        log.warn("A new authorization is required.");
        tokens = null;
      }
    }

    if (tokens !== null) {
      try {
        await applyToken(ipc, tokens);
        return tokens;
      } catch (error) {
        log.warn(`Token rejected: ${(error as Error).message}`);
        tokens = null;
      }
    }
  }

  tokens = await authorize(ipc, options);
  await store.save(tokens);
  log.ok("Authorization saved.");
  await applyToken(ipc, tokens);
  return tokens;
}
