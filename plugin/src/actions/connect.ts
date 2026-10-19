import streamDeck, { action, SingletonAction, type KeyDownEvent } from "@elgato/streamdeck";
import { voicePresence } from "../core/voice-presence-service.js";

/**
 * Connection button.
 *
 * The Infobar is display-only: it cannot receive clicks. Forcing a new Discord
 * authorization therefore requires a key action.
 *
 * Discord offers the consent window only once per granted authorization: this
 * button clears the stored token before requesting it again, otherwise the
 * authorization would be silently reused and nothing would open.
 */
@action({ UUID: "com.lucas.discord-voice-presence.connect" })
export class ConnectAction extends SingletonAction {
	private readonly logger = streamDeck.logger.createScope("action.connect");

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		this.logger.info("Authorization request triggered from a key.");

		await voicePresence.reauthorize();

		// The result is known once the window is accepted: reflect the actual
		// service state, not just the fact that the request was sent.
		if (voicePresence.state.status === "error") {
			await ev.action.showAlert();
		} else {
			await ev.action.showOk();
		}
	}
}
