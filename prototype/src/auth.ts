/**
 * Flux d'autorisation OAuth2 du RPC Discord.
 *
 * Pourquoi c'est indispensable : sans autorisation, le client Discord n'expose
 * que les commandes `rpc.local` (profil de l'utilisateur courant). Toutes les
 * commandes relatives au vocal renvoient `RPC 4006 Not authenticated or invalid
 * scope`. Une autorisation unique (scope `rpc`) debloque l'ensemble.
 *
 * ## PKCE est impossible ici
 *
 * On pouvait esperer un client public, sans secret a embarquer. C'est exclu, et
 * les deux erreurs observees se contredisent :
 *
 *   PKCE sans redirect_uri -> RPC 5000 : Missing "redirect_uri" in request.
 *   PKCE avec redirect_uri -> RPC 5000 : Redirect URI cannot be used in the
 *                                       RPC OAuth2 Authorization flow
 *
 * Autrement dit : le challenge PKCE fait basculer Discord sur un flux avec
 * redirection, alors que le flux OAuth2 du RPC interdit toute redirection. Il
 * faut donc le flux historique, et un `client_secret` pour echanger le code.
 * C'est ce que fait le plugin Discord officiel d'Elgato.
 *
 * ## Le contresens du redirect_uri
 *
 * Le flux exige qu'une URI de redirection soit *enregistree* sur l'application,
 * tout en refusant qu'on l'envoie dans la requete AUTHORIZE. Discord retombe
 * alors sur la premiere URI enregistree. D'ou les deux erreurs symetriques :
 *
 *   aucune URI enregistree -> "Missing redirect_uri"
 *   une URI envoyee        -> "Redirect URI cannot be used in the RPC OAuth2
 *                              Authorization flow"
 *
 * A configurer une seule fois dans le portail : OAuth2 -> Redirects ->
 * `https://127.0.0.1`, en premiere position. C'est un simple bouche-trou : le
 * code arrive par la socket IPC, la redirection n'est jamais suivie.
 *
 * Reference : https://docs.discord.food/topics/oauth2
 */

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
  /** Obligatoire : le RPC OAuth2 n'accepte pas de client public. */
  clientSecret: string;
  scopes: string[];
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

/** URI de secours que Discord utilise quand aucune n'est envoyee dans la requete. */
const PLACEHOLDER_REDIRECT_URI = "https://127.0.0.1";

/**
 * Transforme les erreurs opaques de Discord en consignes exploitables.
 *
 * Le flux OAuth2 du RPC n'accepte aucun `redirect_uri` dans la requete, mais
 * exige qu'une URI soit *enregistree* sur l'application : c'est le contresens
 * le plus courant de cette configuration.
 */
function explainAuthorizeFailure(error: unknown): string {
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
      `  1. ton application -> OAuth2 -> Redirects`,
      `  2. ajoute exactement : ${PLACEHOLDER_REDIRECT_URI}`,
      "  3. place-la en PREMIERE position",
      "  4. Save Changes (l'enregistrement peut prendre une minute a se propager)",
      "  5. relance `npm run auth`",
    ].join("\n");
  }

  return message;
}

/**
 * Demande l'autorisation a l'utilisateur, puis echange le code contre un token.
 *
 * Discord affiche une fenetre de consentement : cette fonction attend que
 * l'utilisateur valide.
 */
export async function authorize(ipc: DiscordIpc, options: AuthOptions): Promise<TokenSet> {
  if (options.clientSecret.trim() === "") {
    throw new Error(
      "DISCORD_CLIENT_SECRET est vide. Le flux OAuth2 du RPC Discord n'accepte pas " +
        "de client public (PKCE est refuse), un secret est donc obligatoire.\n" +
        "Recupere-le dans le portail developpeur : OAuth2 -> Client Secret.",
    );
  }

  log.info(`Scopes demandes : ${options.scopes.join(", ")}`);
  log.warn("Une fenetre d'autorisation va s'ouvrir dans Discord : accepte-la pour continuer.");

  let code: string;
  try {
    const result = await ipc.call<{ code: string }>(
      "AUTHORIZE",
      { client_id: options.clientId, scopes: options.scopes },
      AUTHORIZE_TIMEOUT_MS,
    );

    if (typeof result?.code !== "string") {
      throw new Error(`Reponse AUTHORIZE inattendue : ${JSON.stringify(result)}`);
    }
    code = result.code;
  } catch (error) {
    throw new Error(explainAuthorizeFailure(error));
  }

  log.ok("Code d'autorisation obtenu.");

  const tokens = await requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
    }),
  );

  log.ok(`Autorisation accordee (scopes : ${tokens.scope}).`);
  return tokens;
}

/** Renouvelle un token arrive a expiration. */
export async function refresh(
  tokens: TokenSet,
  options: Pick<AuthOptions, "clientId" | "clientSecret">,
): Promise<TokenSet> {
  log.info("Rafraichissement du token...");
  const refreshed = await requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: options.clientId,
      client_secret: options.clientSecret,
    }),
  );
  log.ok("Token rafraichi.");
  return refreshed;
}

/** Associe la connexion IPC au token d'acces. */
export async function authenticate(ipc: DiscordIpc, accessToken: string): Promise<string> {
  const result = await ipc.call<{ scopes?: string[] }>("AUTHENTICATE", {
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

  // Pas d'appel a AUTHENTICATE ici : le flux AUTHORIZE authentifie deja la
  // connexion en cours. Le rappeler renvoie RPC 4002 "Already authenticated".
  return tokens;
}
