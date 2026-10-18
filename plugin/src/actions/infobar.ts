import streamDeck, {
	action,
	SingletonAction,
	type FeedbackPayload,
	type Pixmap,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";
import { voicePresence, type VoicePresenceState } from "../core/voice-presence-service.js";
import type { Participant } from "../discord/types.js";

const LAYOUT = "layouts/voice-presence.json";

const FRAME = "imgs/infobar/frame.svg";
const FRAME_SPEAKING = "imgs/infobar/frame-speaking.svg";
const BADGE_MUTE = "imgs/infobar/badge-mute.svg";
const BADGE_DEAF = "imgs/infobar/badge-deaf.svg";
const AVATAR_PLACEHOLDER = "imgs/infobar/avatar-placeholder.svg";

/** Nombre d'emplacements definis dans le layout. */
const SLOTS = 5;

/** Au-dela de deux personnes, la rangee est centree plutot qu'alignee a gauche. */
const LEFT_ALIGNED_MAX = 2;

interface InfobarTarget {
	readonly id: string;
	setFeedbackLayout(layout: string): Promise<void>;
	setFeedback(feedback: FeedbackPayload): Promise<void>;
}

type ItemState = Pixmap | string;

/**
 * Action d'Infobar : affichage seul, sans interaction.
 *
 * Les avatars sont des images carrees decoupees en cercle par un cadre superpose
 * (voir tools/generate-infobar.mjs) : aucun pixel n'est manipule ici.
 */
@action({ UUID: "com.lucas.discord-voice-presence.infobar" })
export class VoicePresenceInfobar extends SingletonAction {
	private readonly logger = streamDeck.logger.createScope("action.infobar");
	private readonly subscriptions = new Map<string, () => void>();

	/** Dernier etat envoye par action, pour n'envoyer que ce qui change. */
	private readonly lastSent = new Map<string, Record<string, ItemState>>();

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isNeoInfobar()) {
			this.logger.warn("Action placee ailleurs que sur l'Infobar d'un Neo : ignoree.");
			return;
		}

		const infobar: InfobarTarget = ev.action;
		this.subscriptions.get(infobar.id)?.();
		this.lastSent.delete(infobar.id);

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
		this.lastSent.delete(ev.action.id);
	}

	/** Emplacement de depart, pour centrer la rangee quand elle est courte. */
	#startSlot(count: number): number {
		if (count <= LEFT_ALIGNED_MAX) return 0;
		return Math.max(0, Math.floor((SLOTS - count) / 2));
	}

	/** Badge a afficher, ou `null`. Le casque prime : il coupe aussi le micro. */
	#badgeOf(participant: Participant): string | null {
		if (participant.selfDeaf || participant.serverDeaf) return BADGE_DEAF;
		if (participant.selfMute || participant.serverMute || participant.suppressed) return BADGE_MUTE;
		return null;
	}

	/** Construit la charge utile complete, puis n'envoie que ce qui a change. */
	async #render(infobar: InfobarTarget, state: VoicePresenceState): Promise<void> {
		const payload = await this.#buildPayload(state);

		const previous = this.lastSent.get(infobar.id) ?? {};
		const delta: FeedbackPayload = {};
		let changed = false;

		for (const [key, value] of Object.entries(payload)) {
			if (!sameItem(previous[key], value)) {
				delta[key] = value;
				changed = true;
			}
		}

		if (!changed) {
			return;
		}

		this.lastSent.set(infobar.id, payload);

		try {
			await infobar.setFeedback(delta);
		} catch (error) {
			this.logger.error(`Mise a jour de l'Infobar impossible : ${String(error)}`);
		}
	}

	async #buildPayload(state: VoicePresenceState): Promise<Record<string, ItemState>> {
		const payload: Record<string, ItemState> = {};

		// Tous les emplacements sont toujours decrits : sinon un avatar reste
		// affiche apres le depart de la personne.
		for (let slot = 0; slot < SLOTS; slot += 1) {
			payload[`avatar${slot}`] = { value: "", opacity: 0 };
			payload[`frame${slot}`] = { value: FRAME, opacity: 0 };
			payload[`badge${slot}`] = { value: "", opacity: 0 };
		}

		const participants = state.participants;
		const showAvatars = state.status === "ready" && state.channel !== null && participants.length > 0;

		if (!showAvatars) {
			payload["status"] = this.#statusLine(state);
			payload["detail"] = this.#detailLine(state);
			return payload;
		}

		payload["status"] = "";
		payload["detail"] = "";

		const visible = participants.slice(0, SLOTS);
		const start = this.#startSlot(visible.length);
		const avatars = voicePresence.avatars;

		for (const [index, participant] of visible.entries()) {
			const slot = start + index;

			const dataUrl = avatars === null ? null : await avatars.get(participant.id, participant.avatarHash);
			payload[`avatar${slot}`] = { value: dataUrl ?? AVATAR_PLACEHOLDER, opacity: 1 };
			payload[`frame${slot}`] = {
				value: participant.speaking ? FRAME_SPEAKING : FRAME,
				opacity: 1
			};

			const badge = this.#badgeOf(participant);
			payload[`badge${slot}`] = badge === null ? { value: "", opacity: 0 } : { value: badge, opacity: 1 };
		}

		return payload;
	}

	#statusLine(state: VoicePresenceState): string {
		if (state.status === "error") return "Discord indisponible";
		if (state.status === "connecting") return "Connexion a Discord...";
		if (state.channel === null) return "Pas en vocal";
		return "Salon vide";
	}

	#detailLine(state: VoicePresenceState): string {
		if (state.status === "error") return state.message ?? "Lance le client Discord";
		if (state.status === "connecting") return "Premier lancement : autorise le plugin";
		if (state.channel === null) return "Rejoins un salon vocal";
		return [state.guild, state.channel].filter((part) => part !== null).join(" · ");
	}
}

/**
 * Deux items sont identiques si leur valeur et leur opacite le sont.
 *
 * Comparer directement les chaines suffit : le cache d'avatars renvoie la meme
 * instance de data URI tant que l'avatar n'a pas change, donc aucune comparaison
 * couteuse sur des dizaines de kilo-octets.
 */
function sameItem(previous: ItemState | undefined, next: ItemState): boolean {
	if (previous === next) return true;
	if (typeof previous === "string" || typeof next === "string") return previous === next;
	if (previous === undefined) return false;

	return previous.value === next.value && previous.opacity === next.opacity;
}
