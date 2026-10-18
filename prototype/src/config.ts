/**
 * Chargement de la configuration depuis l'environnement.
 *
 * Le `.env` est lu par Node lui-meme (`--env-file-if-exists=.env`, voir les
 * scripts de package.json) : aucune dependance necessaire.
 */

import path from "node:path";
import { log } from "./log.ts";

export interface Config {
  /** Identifiant public de l'application Discord. Aucun secret n'est necessaire. */
  clientId: string;
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
  "  3. Renseigne DISCORD_CLIENT_ID",
  "",
].join("\n");

export function loadConfig(): Config {
  const clientId = process.env["DISCORD_CLIENT_ID"]?.trim() ?? "";
  if (clientId === "") {
    throw new Error(`${ENV_HELP}Aucune valeur trouvee pour DISCORD_CLIENT_ID.`);
  }

  const scopes = (process.env["DISCORD_SCOPES"]?.trim() || "rpc")
    .split(/[\s,]+/)
    .filter((scope) => scope !== "");

  if (scopes.length === 0) {
    throw new Error("DISCORD_SCOPES ne contient aucun scope exploitable.");
  }

  return {
    clientId,
    scopes,
    dataDir: DATA_DIR,
  };
}

/**
 * Verifie que les prerequis cote portail developpeur sont en place.
 *
 * Un avertissement suffit : le diagnostic precis viendra de Discord, et les
 * messages d'erreur d'auth.ts expliquent alors quoi corriger.
 */
export function warnAboutPortalSetup(): void {
  if ((process.env["DISCORD_CLIENT_SECRET"] ?? "").trim() !== "") {
    log.warn(
      "DISCORD_CLIENT_SECRET est renseigne mais n'est plus utilise : le flux PKCE",
    );
    log.warn("n'embarque aucun secret. Tu peux retirer cette ligne du .env.");
  }
}
