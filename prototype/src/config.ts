/**
 * Chargement de la configuration depuis l'environnement.
 *
 * Le `.env` est lu par Node lui-meme (`--env-file-if-exists=.env`, voir les
 * scripts de package.json) : aucune dependance necessaire.
 */

import path from "node:path";

export interface Config {
  clientId: string;
  /** Obligatoire : le flux OAuth2 du RPC Discord refuse les clients publics. */
  clientSecret: string;
  scopes: string[];
  /** Dossier des donnees locales (tokens, cache d'avatars), ignore par git. */
  dataDir: string;
}

export const DATA_DIR = path.resolve(import.meta.dirname, "..", ".data");
export const AUTH_FILE = path.join(DATA_DIR, "auth.json");
export const AVATAR_DIR = path.join(DATA_DIR, "avatars");
export const OUT_DIR = path.resolve(import.meta.dirname, "..", "out");

const ENV_HELP = [
  "Configuration manquante.",
  "",
  "  1. Copie le modele :   copy .env.example .env",
  "  2. Cree une application sur https://discord.com/developers/applications",
  "  3. Renseigne DISCORD_CLIENT_ID et DISCORD_CLIENT_SECRET",
  "",
].join("\n");

export function loadConfig(): Config {
  const clientId = process.env["DISCORD_CLIENT_ID"]?.trim() ?? "";
  if (clientId === "") {
    throw new Error(`${ENV_HELP}Aucune valeur trouvee pour DISCORD_CLIENT_ID.`);
  }

  const clientSecret = process.env["DISCORD_CLIENT_SECRET"]?.trim() ?? "";
  if (clientSecret === "") {
    throw new Error(
      `${ENV_HELP}Aucune valeur trouvee pour DISCORD_CLIENT_SECRET.\n` +
        "Il est obligatoire : le flux OAuth2 du RPC Discord refuse les clients publics (PKCE).",
    );
  }

  const scopes = (process.env["DISCORD_SCOPES"]?.trim() || "rpc")
    .split(/[\s,]+/)
    .filter((scope) => scope !== "");

  if (scopes.length === 0) {
    throw new Error("DISCORD_SCOPES ne contient aucun scope exploitable.");
  }

  return {
    clientId,
    clientSecret,
    scopes,
    dataDir: DATA_DIR,
  };
}
