/**
 * Conservation des jetons OAuth dans les reglages globaux de Stream Deck.
 *
 * Les reglages globaux sont partages par toutes les actions du plugin et
 * persistent entre deux sessions, ce qui evite d'ecrire un fichier et de
 * dependre du dossier d'installation.
 *
 * Le jeton est stocke serialise en JSON : les reglages de Stream Deck n'acceptent
 * que des valeurs JSON simples, et cela evite de faire dependre la logique
 * d'autorisation d'un format particulier.
 */

import streamDeck from "@elgato/streamdeck";
import { isTokenSet, type TokenSet, type TokenStore } from "./auth.js";

const TOKENS_KEY = "discordTokens";

/**
 * Forme des reglages globaux telle qu'on l'utilise.
 *
 * On n'y stocke que des chaines, ce qui satisfait la contrainte `JsonObject` du
 * SDK sans avoir a manipuler ses types internes.
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
		// Lecture puis ecriture : `setGlobalSettings` remplace la cle fournie,
		// mais d'autres cles du plugin peuvent exister.
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
