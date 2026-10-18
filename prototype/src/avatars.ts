/**
 * Recuperation et cache des avatars.
 *
 * Deux sources, dans cet ordre :
 *   1. `GET_IMAGE` du RPC local : pas d'appel reseau, renvoie un data URI, et
 *      reflete exactement l'avatar tel que le client Discord l'affiche.
 *   2. Le CDN (`cdn.discordapp.com`), en secours.
 *
 * Les images sont ecrites sur disque car le plugin Stream Deck attend des
 * chemins de fichiers sous son dossier, et parce que le cache evite de
 * re-telecharger a chaque mise a jour de l'Infobar.
 */

import fs from "node:fs";
import path from "node:path";
import type { DiscordIpc } from "./ipc.ts";
import { log } from "./log.ts";
import type { RpcImage, Snowflake } from "./types.ts";
import { avatarUrl } from "./voice.ts";

const DEFAULT_SIZE = 128;

export class AvatarStore {
  readonly #ipc: DiscordIpc;
  readonly #dir: string;
  readonly #memory = new Map<string, Buffer>();

  constructor(ipc: DiscordIpc, directory: string) {
    this.#ipc = ipc;
    this.#dir = directory;
  }

  get directory(): string {
    return this.#dir;
  }

  /**
   * Renvoie le PNG de l'avatar d'un utilisateur.
   *
   * `avatarHash` fait partie de la cle de cache : quand quelqu'un change
   * d'avatar, un nouveau fichier est cree plutot que de servir l'ancien.
   */
  async get(
    userId: Snowflake,
    avatarHash: string | null,
    size: number = DEFAULT_SIZE,
  ): Promise<Buffer | null> {
    const key = `${userId}-${avatarHash ?? "default"}-${size}`;

    const cached = this.#memory.get(key);
    if (cached !== undefined) return cached;

    const file = path.join(this.#dir, `${key}.png`);
    if (fs.existsSync(file)) {
      const buffer = fs.readFileSync(file);
      this.#memory.set(key, buffer);
      return buffer;
    }

    const buffer = (await this.#fromRpc(userId, size)) ?? (await this.#fromCdn(userId, avatarHash, size));
    if (buffer === null) {
      log.warn(`Avatar introuvable pour ${userId}.`);
      return null;
    }

    fs.mkdirSync(this.#dir, { recursive: true });
    fs.writeFileSync(file, buffer);
    this.#memory.set(key, buffer);
    return buffer;
  }

  /** Supprime les avatars en cache dont le hash n'est plus celui de l'utilisateur. */
  prune(keepKeys: ReadonlySet<string>): number {
    if (!fs.existsSync(this.#dir)) return 0;

    let removed = 0;
    for (const entry of fs.readdirSync(this.#dir)) {
      if (!entry.endsWith(".png")) continue;
      const key = entry.slice(0, -4);
      // Une cle se termine par la taille : on ignore celle-ci pour le test.
      const withoutSize = key.replace(/-\d+$/, "");
      if (keepKeys.has(withoutSize)) continue;

      fs.rmSync(path.join(this.#dir, entry), { force: true });
      removed += 1;
    }
    return removed;
  }

  // --- Sources ---------------------------------------------------------------

  async #fromRpc(userId: Snowflake, size: number): Promise<Buffer | null> {
    try {
      const image = await this.#ipc.call<RpcImage>("GET_IMAGE", {
        type: "user",
        id: userId,
        format: "png",
        size,
      });
      if (typeof image?.data_url !== "string") return null;
      return decodeDataUrl(image.data_url);
    } catch (error) {
      log.warn(`GET_IMAGE a echoue pour ${userId} : ${(error as Error).message}`);
      return null;
    }
  }

  async #fromCdn(
    userId: Snowflake,
    avatarHash: string | null,
    size: number,
  ): Promise<Buffer | null> {
    const url = avatarUrl({ id: userId, avatar: avatarHash }, size);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        log.warn(`CDN a repondu ${response.status} pour ${userId}.`);
        return null;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      log.warn(`Telechargement de l'avatar ${userId} impossible : ${(error as Error).message}`);
      return null;
    }
  }
}

/** Decode un `data:image/png;base64,...` en Buffer. */
export function decodeDataUrl(dataUrl: string): Buffer | null {
  const separator = dataUrl.indexOf(",");
  if (separator === -1) return null;
  if (!dataUrl.slice(0, separator).includes("base64")) return null;

  try {
    return Buffer.from(dataUrl.slice(separator + 1), "base64");
  } catch {
    return null;
  }
}

/** Reencode un PNG en data URI, pour la valeur d'un item `pixmap`. */
export function toDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}
