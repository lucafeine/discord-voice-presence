/**
 * Stores OAuth tokens in Stream Deck global settings.
 *
 * Global settings are shared by all plugin actions and persist between
 * sessions, which avoids writing a file and depending on the installation
 * folder.
 *
 * The token is stored as serialized JSON: Stream Deck settings only accept
 * simple JSON values, and this keeps the authorization logic independent of a
 * particular format.
 */

import streamDeck from "@elgato/streamdeck";
import { isTokenSet, type TokenSet, type TokenStore } from "./auth.js";

const TOKENS_KEY = "discordTokens";

/**
 * Shape of global settings as used here.
 *
 * Only strings are stored, which satisfies the SDK's `JsonObject` constraint
 * without manipulating its internal types.
 */
type GlobalSettings = Record<string, string>;

export class GlobalSettingsTokenStore implements TokenStore {
	async load(): Promise<TokenSet | null> {
		const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		const raw = settings[TOKENS_KEY];
		if (typeof raw !== "string") {
			return null;
		}

		try {
			const parsed: unknown = JSON.parse(raw);
			return isTokenSet(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	async save(tokens: TokenSet): Promise<void> {
		// Read then write: `setGlobalSettings` replaces the provided key, but
		// other plugin keys may exist.
		const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		await streamDeck.settings.setGlobalSettings({
			...settings,
			[TOKENS_KEY]: JSON.stringify(tokens)
		});
	}

	async clear(): Promise<void> {
		const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		const { [TOKENS_KEY]: _removed, ...rest } = settings;
		await streamDeck.settings.setGlobalSettings(rest);
	}
}
