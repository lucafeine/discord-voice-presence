import streamDeck, {
	action,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";

const LAYOUT = "layouts/voice-presence.json";

/**
 * Action d'Infobar : affichage seul, sans interaction.
 *
 * Le rendu passe par le moteur de layouts du Stream Deck (voir
 * layouts/voice-presence.json). A ce stade, un simple item texte sert a valider
 * la chaine complete jusqu'au device.
 */
@action({ UUID: "com.lucas.discord-voice-presence.infobar" })
export class VoicePresenceInfobar extends SingletonAction {
	private readonly logger = streamDeck.logger.createScope("action.infobar");

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isNeoInfobar()) {
			this.logger.warn("Action placee ailleurs que sur l'Infobar d'un Neo : ignoree.");
			return;
		}

		try {
			// Le layout doit etre (re)defini a chaque apparition : Stream Deck
			// ne conserve pas ce reglage entre deux sessions.
			await ev.action.setFeedbackLayout(LAYOUT);
			await ev.action.setFeedback({ status: "Voice Presence" });
		} catch (error) {
			this.logger.error(`Mise a jour de l'Infobar impossible : ${String(error)}`);
		}
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.logger.info(`Action retiree de l'Infobar (${ev.action.id}).`);
	}
}
