/**
 * Avatars pour l'Infobar.
 *
 * Le moteur de layouts accepte, pour un item `pixmap`, une chaine base64 en plus
 * d'un fichier local : on lui passe donc directement des data URI. Aucun fichier
 * n'est ecrit, et le plugin ne depend pas de son propre dossier d'installation.
 *
 * `GET_IMAGE` du RPC local est privilegie : aucun appel reseau, et l'image est
 * exactement celle que le client Discord affiche. Le CDN n'est qu'un secours.
 */

import type { DiscordIpc } from "./ipc.js";
import { log } from "./log.js";
import type { RpcImage, Snowflake } from "./types.js";
import { avatarUrl } from "./voice.js";

/** Puissance de deux comprise entre 16 et 1024, comme l'exige l'API. */
const SIZE = 128;

/** Delai maximal du repli CDN : le seul appel reseau du plugin. */
const CDN_TIMEOUT_MS = 10_000;

export class AvatarCache {
	readonly #ipc: DiscordIpc;
	readonly #memory = new Map<string, string>();

	constructor(ipc: DiscordIpc) {
		this.#ipc = ipc;
	}

	/**
	 * Renvoie un data URI PNG, ou `null` si l'avatar est introuvable.
	 *
	 * Le hash fait partie de la cle : changer d'avatar donne une nouvelle entree
	 * plutot qu'une image perimee.
	 */
	async get(userId: Snowflake, avatarHash: string | null): Promise<string | null> {
		const key = `${userId}-${avatarHash ?? "default"}`;

		const cached = this.#memory.get(key);
		if (cached !== undefined) {
			return cached;
		}

		const dataUrl = (await this.#fromRpc(userId)) ?? (await this.#fromCdn(userId, avatarHash));
		if (dataUrl !== null) {
			this.#memory.set(key, dataUrl);
		}
		return dataUrl;
	}

	async #fromRpc(userId: Snowflake): Promise<string | null> {
		try {
			const image = await this.#ipc.call<RpcImage>("GET_IMAGE", {
				type: "user",
				id: userId,
				format: "png",
				size: SIZE
			});
			return typeof image?.data_url === "string" ? image.data_url : null;
		} catch (error) {
			log.warn(`GET_IMAGE a echoue pour ${userId} : ${(error as Error).message}`);
			return null;
		}
	}

	async #fromCdn(userId: Snowflake, avatarHash: string | null): Promise<string | null> {
		try {
			const response = await fetch(avatarUrl({ id: userId, avatar: avatarHash }, SIZE), {
				signal: AbortSignal.timeout(CDN_TIMEOUT_MS)
			});
			if (!response.ok) {
				log.warn(`CDN a repondu ${response.status} pour ${userId}.`);
				return null;
			}
			const buffer = Buffer.from(await response.arrayBuffer());
			return `data:image/png;base64,${buffer.toString("base64")}`;
		} catch (error) {
			log.warn(`Telechargement de l'avatar ${userId} impossible : ${(error as Error).message}`);
			return null;
		}
	}
}
