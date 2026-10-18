/**
 * Flux d'autorisation OAuth2 du RPC Discord.
 *
 * Pourquoi c'est indispensable : sans autorisation, le client Discord n'expose
 * que les commandes `rpc.local` (profil de l'utilisateur courant). Toutes les
 * commandes relatives au vocal renvoient `RPC 4006 Not authenticated or invalid
 * scope`. Une autorisation unique (scope `rpc`) debloque l'ensemble.
 *
 * Deux variantes sont tentees, dans cet ordre :
 *   1. PKCE (client public) : aucun secret a embarquer dans le plugin.
 *   2. Code + client_secret : la variante historique, utilisee par Elgato.
 *
 * Reference : https://docs.discord.food/topics/oauth2
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log.ts";
import type { DiscordIpc } from "./ipc.ts";

const TOKEN_URL = "https://discord.com/api/oauth2/token";

/** Duree laissee a l'utilisateur pour accepter la demande dans Discord. */
const AUTHORIZE_TIMEOUT_MS = 180_000;

/** Marge avant expiration : on rafraichit un peu avant l'echeance reelle. */
const EXPIRY_MARGIN_MS = 60_000;

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
  /** Date d'expiration, en millisecondes epoch. */
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
  clientId: string;
  clientSecret: string | undefined;
  scopes: string[];
  usePkce: boolean;
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
    throw new Error(`Echange de token refuse (HTTP ${response.status}) : ${text}`);
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
 * Demande l'autorisation a l'utilisateur, puis echange le code contre un token.
 *
 * Discord affiche une fenetre de consentement : cette fonction attend que
 * l'utilisateur valide.
 */
export async function authorize(ipc: DiscordIpc, options: AuthOptions): Promise<TokenSet> {
  const pkce = options.usePkce ? createPkcePair() : null;

  if (pkce !== null) {
    log.info("Tentative en PKCE (client public, sans client_secret).");
  } else if (options.clientSecret === undefined) {
    throw new Error(
      "DISCORD_USE_PKCE=false mais aucun DISCORD_CLIENT_SECRET n'est renseigne : l'echange est impossible.",
    );
  } else {
    log.info("Tentative en code + client_secret.");
  }

  log.warn("Une fenetre d'autorisation va s'ouvrir dans Discord : accepte-la pour continuer.");

  const authArgs: Record<string, unknown> = {
    client_id: options.clientId,
    scopes: options.scopes,
    response_type: "code",
  };
  if (pkce !== null) {
    authArgs["code_challenge"] = pkce.challenge;
    authArgs["code_challenge_method"] = "S256";
  }

  const result = await ipc.call<{ code: string }>("AUTHORIZE", authArgs, AUTHORIZE_TIMEOUT_MS);
  if (typeof result?.code !== "string") {
    throw new Error(`Reponse AUTHORIZE inattendue : ${JSON.stringify(result)}`);
  }
  log.ok("Code d'autorisation obtenu.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: result.code,
    client_id: options.clientId,
  });

  if (pkce !== null) {
    body.set("code_verifier", pkce.verifier);
  } else if (options.clientSecret !== undefined) {
    body.set("client_secret", options.clientSecret);
  }

  const tokens = await requestToken(body);
  log.ok(`Autorisation accordee (scopes : ${tokens.scope}).`);
  return tokens;
}

/** Renouvelle un token arrive a expiration. */
export async function refresh(
  tokens: TokenSet,
  options: Pick<AuthOptions, "clientId" | "clientSecret">,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: options.clientId,
  });
  if (options.clientSecret !== undefined) {
    body.set("client_secret", options.clientSecret);
  }

  log.info("Rafraichissement du token...");
  const refreshed = await requestToken(body);
  log.ok("Token rafraichi.");
  return refreshed;
}

/** Associe la connexion IPC au token d'acces. */
export async function authenticate(ipc: DiscordIpc, accessToken: string): Promise<string> {
  const result = await ipc.call<{ scopes?: string[]; expires?: string }>("AUTHENTICATE", {
    access_token: accessToken,
  });
  return (result?.scopes ?? []).join(" ");
}

export function isExpired(tokens: TokenSet): boolean {
  return Date.now() >= tokens.expires_at - EXPIRY_MARGIN_MS;
}

// --- Persistance -------------------------------------------------------------

export function loadTokens(authFile: string): TokenSet | null {
  if (!fs.existsSync(authFile)) return null;
  try {
    const tokens = JSON.parse(fs.readFileSync(authFile, "utf8")) as TokenSet;
    if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string") {
      return null;
    }
    return tokens;
  } catch {
    log.warn(`${path.basename(authFile)} illisible, il sera regenere.`);
    return null;
  }
}

export function saveTokens(authFile: string, tokens: TokenSet): void {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Garantit une connexion IPC autorisee : reutilise le token stocke, le
 * rafraichit si besoin, sinon lance le consentement.
 */
export async function ensureAuthenticated(
  ipc: DiscordIpc,
  authFile: string,
  options: AuthOptions,
): Promise<TokenSet> {
  let tokens = loadTokens(authFile);

  if (tokens !== null) {
    if (isExpired(tokens)) {
      try {
        tokens = await refresh(tokens, options);
        saveTokens(authFile, tokens);
      } catch (error) {
        log.warn(`Rafraichissement impossible : ${(error as Error).message}`);
        log.warn("Nouvelle autorisation necessaire.");
        tokens = null;
      }
    }

    if (tokens !== null) {
      try {
        const scopes = await authenticate(ipc, tokens.access_token);
        log.ok(`Connecte au RPC Discord (scopes : ${scopes}).`);
        return tokens;
      } catch (error) {
        log.warn(`Token refuse : ${(error as Error).message}`);
        tokens = null;
      }
    }
  }

  tokens = await authorize(ipc, options);
  saveTokens(authFile, tokens);
  log.ok(`Token stocke dans ${path.relative(process.cwd(), authFile)}`);
  await authenticate(ipc, tokens.access_token);
  return tokens;
}
