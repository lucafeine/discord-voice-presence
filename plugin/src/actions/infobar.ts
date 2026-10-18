import streamDeck, {
	action,
	SingletonAction,
	type FeedbackPayload,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";
import { voicePresence, type VoicePresenceState } from "../core/voice-presence-service.js";

const LAYOUT = "layouts/voice-presence.json";

/**
 * Ce dont le rendu a besoin d'une action d'Infobar.
 *
 * Type structurel plutot que le type exact du SDK : apres le garde
 * `isNeoInfobar()`, la valeur est deja restreinte, et cela evite de dependre du
 * nom interne du type d'action.
 */
interface InfobarTarget {
	readonly id: string;
	setFeedbackLayout(layout: string): Promise<void>;
	setFeedback(feedback: FeedbackPayload): Promise<void>;
}

/**
 * Action d'Infobar : affichage seul, sans interaction.
 *
 * Le rendu passe par le moteur de layouts du Stream Deck. A ce stade tout est
 * en texte : les items natifs savent tronquer avec des points de suspension,
 * ce qui evite d'ecrire un moteur de texte dans le plugin.
 */
@action({ UUID: "com.lucas.discord-voice-presence.infobar" })
export class VoicePresenceInfobar extends SingletonAction {
	private readonly logger = streamDeck.logger.createScope("action.infobar");
	private readonly subscriptions = new Map<string, () => void>();

	/** Dernier rendu par action, pour ne pas renvoyer deux fois la meme image. */
	private readonly lastRendered = new Map<string, string>();

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isNeoInfobar()) {
			this.logger.warn("Action placee ailleurs que sur l'Infobar d'un Neo : ignoree.");
			return;
		}

		const infobar: InfobarTarget = ev.action;
		this.subscriptions.get(infobar.id)?.();

		try {
			// Le layout doit etre (re)defini a chaque apparition : Stream Deck ne
			// conserve pas ce reglage entre deux sessions.
			await infobar.setFeedbackLayout(LAYOUT);
		} catch (error) {
			this.logger.error(`Impossible de definir le layout : ${String(error)}`);
		}

		const unsubscribe = voicePresence.subscribe((state) => {
			void this.#render(infobar, state);
		});

		this.subscriptions.set(infobar.id, unsubscribe);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.subscriptions.get(ev.action.id)?.();
		this.subscriptions.delete(ev.action.id);
		this.lastRendered.delete(ev.action.id);
	}

	/** Traduit l'etat du service en deux lignes de texte. */
	#describe(state: VoicePresenceState): { title: string; detail: string } {
		if (state.status === "error") {
			return {
				title: "Discord indisponible",
				detail: state.message ?? "Lance le client Discord"
			};
		}

		if (state.status === "connecting") {
			return { title: "Connexion a Discord...", detail: "Premier lancement : autorise le plugin" };
		}

		if (state.channel === null) {
			return { title: "Pas en vocal", detail: "Rejoins un salon vocal" };
		}

		if (state.participants.length === 0) {
			return { title: "Salon vide", detail: state.channel };
		}

		const names = state.participants.map((participant) => participant.name).join(", ");
		const detail = [state.guild, state.channel].filter((part) => part !== null).join(" · ");

		return { title: names, detail };
	}

	async #render(infobar: InfobarTarget, state: VoicePresenceState): Promise<void> {
		const { title, detail } = this.#describe(state);

		// Sans cette deduplication, chaque evenement (parole, mute...) renverrait
		// une image identique. Les guidelines limitent a 10 mises a jour/seconde.
		const key = `${title}\u0000${detail}`;
		if (this.lastRendered.get(infobar.id) === key) {
			return;
		}
		this.lastRendered.set(infobar.id, key);

		try {
			await infobar.setFeedback({ title, detail } satisfies FeedbackPayload);
		} catch (error) {
			this.logger.error(`Mise a jour de l'Infobar impossible : ${String(error)}`);
		}
	}
}
