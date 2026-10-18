import streamDeck, { action, SingletonAction, type KeyDownEvent } from "@elgato/streamdeck";
import { voicePresence } from "../core/voice-presence-service.js";

/**
 * Bouton de connexion.
 *
 * L'Infobar est en affichage seul : elle ne peut pas recevoir de clic. Forcer une
 * nouvelle autorisation Discord demande donc une action a touche.
 *
 * Discord ne propose la fenetre de consentement qu'une fois par autorisation
 * accordee : ce bouton efface le jeton enregistre avant de la redemander, sinon
 * l'autorisation serait silencieusement reutilisee et rien ne s'ouvrirait.
 */
@action({ UUID: "com.lucas.discord-voice-presence.connect" })
export class ConnectAction extends SingletonAction {
	private readonly logger = streamDeck.logger.createScope("action.connect");

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		this.logger.info("Demande d'autorisation declenchee depuis une touche.");

		await voicePresence.reauthorize();

		// Le resultat est connu une fois la fenetre acceptee : on reflete donc
		// l'etat reel du service, pas le simple fait d'avoir envoye la demande.
		if (voicePresence.state.status === "error") {
			await ev.action.showAlert();
		} else {
			await ev.action.showOk();
		}
	}
}
