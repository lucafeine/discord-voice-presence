/**
 * Flux d'autorisation OAuth2 du RPC Discord.
 *
 * Pourquoi c'est indispensable : sans autorisation, le client Discord n'expose
 * que les commandes `rpc.local` (profil de l'utilisateur courant). Toutes les
 * commandes relatives au vocal renvoient `RPC 4006 Not authenticated or invalid
 * scope`. Une autorisation unique (scope `rpc`) debloque l'ensemble.
 *
 * ## PKCE, sans aucun secret
 *
 * Le plugin n'embarque ni ne stocke de `client_secret` : le flux utilise PKCE
 * (S256) avec le seul `client_id`, qui est public par nature.
 *
 * Cela impose UNE case a cocher dans le portail developpeur :
 *
 *   ton application -> OAuth2 -> Public Client -> active -> Save Changes
 *
 * Sans elle, l'echange du code repond `HTTP 401 invalid_client`, ce qui ressemble
 * a tort a une incompatibilite du flux RPC. C'est le principal piege de cette
 * configuration.
 *
 * ## Le redirect_uri doit etre enregistre, mais jamais envoye
 *
 * Le flux OAuth2 du RPC refuse tout `redirect_uri` dans la requete AUTHORIZE
 * ("Redirect URI cannot be used in the RPC OAuth2 Authorization flow"), tout en
 * exigeant qu'une URI soit enregistree sur l'application pour avoir une valeur
 * par defaut (sinon : "Missing redirect_uri in request"). A configurer une seule
 * fois : OAuth2 -> Redirects -> une URI quelconque, en premiere position.
 *
 * ## Ordre des operations
 *
 *   AUTHORIZE -> code -> echange PKCE -> access_token -> AUTHENTICATE
 *
 * Selon les cas, Discord authentifie deja la connexion au moment de l'accord :
 * AUTHENTICATE renvoie alors `RPC 4002 Already authenticated`, ce qui n'est pas
 * une erreur.
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
  /** Identifiant public de l'application. Aucun secret n'est necessaire. */
  clientId: string;
  scopes: string[];
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
 * Transforme les erreurs opaques de Discord en consignes exploitables.
 *
 * Les deux echecs courants de cette configuration sont `invalid_client`
 * (Public Client non active) et `Missing redirect_uri` (aucune URI de
 * redirection enregistree).
 */
function explainAuthorizeFailure(error: unknown, clientId: string): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("redirect_uri")) {
    return [
      message,
      "",
      "Le flux OAuth2 du RPC Discord n'accepte aucun redirect_uri dans la requete,",
      "mais exige qu'une URI soit ENREGISTREE sur l'application (Discord utilise la",
      "premiere de la liste par defaut).",
      "",
      "A faire une seule fois, dans le portail developpeur :",
      "  1. ton application -> OAuth2 -> Redirects",
      "  2. ajoute une URI, par exemple : http://localhost",
      "  3. place-la en PREMIERE position, puis Save Changes",
      `      https://discord.com/developers/applications/${clientId}/oauth2`,
    ].join("\n");
  }

  return message;
}

/**
 * Demande l'autorisation a l'utilisateur, puis echange le code en PKCE.
 *
 * Discord affiche une fenetre de consentement : cette fonction attend que
 * l'utilisateur valide.
 */
export async function authorize(ipc: DiscordIpc, options: AuthOptions): Promise<TokenSet> {
  const pkce = createPkcePair();

  log.info(`Scopes demandes : ${options.scopes.join(", ")}`);
  log.info("Flux PKCE (S256) : aucun client_secret n'est utilise.");
  log.warn("Une fenetre d'autorisation va s'ouvrir dans Discord : accepte-la pour continuer.");

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
      throw new Error(`Reponse AUTHORIZE inattendue : ${JSON.stringify(result)}`);
    }
    code = result.code;
  } catch (error) {
    throw new Error(explainAuthorizeFailure(error, options.clientId));
  }

  log.ok("Code d'autorisation obtenu.");

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
          "L'application n'accepte pas les clients publics. A activer une seule fois :",
          "  ton application -> OAuth2 -> Public Client -> active -> Save Changes",
          `  https://discord.com/developers/applications/${options.clientId}/oauth2`,
          "",
          "C'est ce reglage qui autorise PKCE, donc l'absence de client_secret.",
        ].join("\n"),
      );
    }
    throw error;
  }

  log.ok(`Autorisation accordee (scopes : ${tokens.scope}).`);
  return tokens;
}

/** Renouvelle un token arrive a expiration. Pas de secret ici non plus. */
export async function refresh(
  tokens: TokenSet,
  options: Pick<AuthOptions, "clientId">,
): Promise<TokenSet> {
  log.info("Rafraichissement du token...");
  const refreshed = await requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: options.clientId,
    }),
  );
  log.ok("Token rafraichi.");
  return refreshed;
}

/**
 * Associe la connexion IPC au token d'acces.
 *
 * `RPC 4002 Already authenticated` signifie que le flux d'autorisation a deja
 * authentifie la connexion : ce n'est pas un echec.
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

/** Authentifie la connexion, en tolerant le cas deja authentifie. */
export async function applyToken(ipc: DiscordIpc, tokens: TokenSet): Promise<void> {
  try {
    const scopes = await authenticate(ipc, tokens.access_token);
    log.ok(`Connecte au RPC Discord (scopes : ${scopes}).`);
  } catch (error) {
    if (isAlreadyAuthenticated(error)) {
      log.ok("Connexion deja authentifiee par l'autorisation.");
      return;
    }
    throw error;
  }
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
        await applyToken(ipc, tokens);
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
  await applyToken(ipc, tokens);
  return tokens;
}
