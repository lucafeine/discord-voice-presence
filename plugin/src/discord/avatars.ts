/**
 * Avatars for the Infobar.
 *
 * The layout engine accepts a base64 string for a `pixmap` item in addition to a
 * local file, so data URIs are passed directly. No file is written, and the
 * plugin does not depend on its own installation folder.
 *
 * The local RPC `GET_IMAGE` is preferred: no network call, and the image is
 * exactly what the Discord client displays. The CDN is only a fallback.
 */

import type { DiscordIpc } from "./ipc.js";
import { log } from "./log.js";
import type { RpcImage, Snowflake } from "./types.js";
import { avatarUrl } from "./voice.js";

/** Power of two between 16 and 1024, as required by the API. */
const SIZE = 128;

/** Maximum CDN fallback delay: the plugin's only network call. */
const CDN_TIMEOUT_MS = 10_000;

export class AvatarCache {
	readonly #ipc: DiscordIpc;
	readonly #memory = new Map<string, string>();

	constructor(ipc: DiscordIpc) {
		this.#ipc = ipc;
	}

	/**
	 * Returns a PNG data URI, or `null` if the avatar cannot be found.
	 *
	 * The hash is part of the key: changing avatar creates a new entry rather
	 * than serving a stale image.
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
			log.warn(`GET_IMAGE failed for ${userId}: ${(error as Error).message}`);
			return null;
		}
	}

	async #fromCdn(userId: Snowflake, avatarHash: string | null): Promise<string | null> {
		try {
			const response = await fetch(avatarUrl({ id: userId, avatar: avatarHash }, SIZE), {
				signal: AbortSignal.timeout(CDN_TIMEOUT_MS)
			});
			if (!response.ok) {
				log.warn(`CDN responded ${response.status} for ${userId}.`);
				return null;
			}
			const buffer = Buffer.from(await response.arrayBuffer());
			return `data:image/png;base64,${buffer.toString("base64")}`;
		} catch (error) {
			log.warn(`Cannot download avatar ${userId}: ${(error as Error).message}`);
			return null;
		}
	}
}
