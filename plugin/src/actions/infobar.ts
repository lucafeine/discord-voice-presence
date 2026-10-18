import streamDeck, {
	action,
	SingletonAction,
	type FeedbackPayload,
	type Pixmap,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";
import {
	voicePresence,
	type VoiceAlert,
	type VoicePresenceState
} from "../core/voice-presence-service.js";
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

/** Duree d'affichage de chaque alerte, en millisecondes. */
const ALERT_DURATION_MS: Record<VoiceAlert["kind"], number> = {
	joined: 3500,
	left: 3500,
	channel: 3000
};

/**
 * Rappel d'une coupure : un voile opaque de 1 s, toutes les 5 s, tant que ca dure.
 *
 * Il ne concerne que TON propre etat : masquer la rangee en boucle parce qu'un
 * autre participant est coupe serait insupportable. Deux mises a jour par cycle,
 * tres loin de la limite de 10 par seconde des guidelines.
 */
const FLASH_ON_MS = 1_000;
const FLASH_CYCLE_MS = 5_000;

/** Message du voile, par type de coupure. */
const FLASH_MESSAGE: Record<CutKind, string> = {
	mute: "Vous êtes muet",
	deafen: "Vous êtes en sourdine"
};

/** Au-dela, on jette : mieux vaut rater une annonce que rester en retard. */
const MAX_QUEUE = 4;

interface InfobarTarget {
	readonly id: string;
	setFeedbackLayout(layout: string): Promise<void>;
	setFeedback(feedback: FeedbackPayload): Promise<void>;
}

type ItemState = Pixmap | string;

/** Coupure la plus severe presente dans le salon. */
type CutKind = "mute" | "deafen";

/** Etat de la file d'alertes d'une action. */
interface AlertSlot {
	queue: VoiceAlert[];
	current: VoiceAlert | null;
	timer: NodeJS.Timeout | null;
}

/** Etat du voile de rappel d'une action. */
interface FlashSlot {
	/** Vrai pendant la seconde ou le voile est visible. */
	on: boolean;
	onTimer: NodeJS.Timeout | null;
	cycleTimer: NodeJS.Timeout | null;
}

/**
 * Action d'Infobar : affichage seul, sans interaction.
 *
 * Les avatars sont des images carrees decoupees en cercle par un cadre superpose
 * (voir tools/generate-infobar.mjs) : aucun pixel n'est manipule ici.
 *
 * Les annonces d'arrivee et de depart sont une surcouche du MEME layout, pas un
 * second layout : changer de layout a chaque evenement demanderait un
 * aller-retour et ferait clignoter l'affichage.
 */
@action({ UUID: "com.lucas.discord-voice-presence.infobar" })
export class VoicePresenceInfobar extends SingletonAction {
	private readonly logger = streamDeck.logger.createScope("action.infobar");
	private readonly subscriptions = new Map<string, () => void>();
	private readonly alertSubscriptions = new Map<string, () => void>();

	/** Dernier etat envoye par action, pour n'envoyer que ce qui change. */
	private readonly lastSent = new Map<string, Record<string, ItemState>>();

	/** Dernier etat connu, pour redessiner quand une alerte commence ou finit. */
	private readonly lastState = new Map<string, VoicePresenceState>();

	private readonly alerts = new Map<string, AlertSlot>();
	private readonly flashes = new Map<string, FlashSlot>();

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isNeoInfobar()) {
			this.logger.warn("Action placee ailleurs que sur l'Infobar d'un Neo : ignoree.");
			return;
		}

		const infobar: InfobarTarget = ev.action;
		this.#forget(infobar.id);

		try {
			// Le layout doit etre (re)defini a chaque apparition : Stream Deck ne
			// conserve pas ce reglage entre deux sessions.
			await infobar.setFeedbackLayout(LAYOUT);
		} catch (error) {
			this.logger.error(`Impossible de definir le layout : ${String(error)}`);
		}

		this.subscriptions.set(
			infobar.id,
			voicePresence.subscribe((state) => {
				this.lastState.set(infobar.id, state);
				void this.#render(infobar);
			})
		);

		this.alertSubscriptions.set(
			infobar.id,
			voicePresence.onAlert((alert) => this.#enqueue(infobar, alert))
		);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.#forget(ev.action.id);
	}

	#forget(id: string): void {
		this.subscriptions.get(id)?.();
		this.subscriptions.delete(id);
		this.alertSubscriptions.get(id)?.();
		this.alertSubscriptions.delete(id);

		const alert = this.alerts.get(id);
		if (alert?.timer != null) clearTimeout(alert.timer);
		this.alerts.delete(id);

		this.#stopFlash(id);
		this.flashes.delete(id);

		this.lastSent.delete(id);
		this.lastState.delete(id);
	}

	// --- File d'alertes ------------------------------------------------------

	#slotFor(id: string): AlertSlot {
		const existing = this.alerts.get(id);
		if (existing !== undefined) return existing;

		const created: AlertSlot = { queue: [], current: null, timer: null };
		this.alerts.set(id, created);
		return created;
	}

	#enqueue(infobar: InfobarTarget, alert: VoiceAlert): void {
		const slot = this.#slotFor(infobar.id);

		if (slot.queue.length >= MAX_QUEUE) {
			this.logger.warn(`File d'alertes pleine, ${alert.kind} ignoree.`);
			return;
		}

		slot.queue.push(alert);
		this.#advance(infobar);
	}

	/** Passe a l'alerte suivante, ou revient a la rangee s'il n'y en a plus. */
	#advance(infobar: InfobarTarget): void {
		const slot = this.#slotFor(infobar.id);
		if (slot.current !== null) return;

		const next = slot.queue.shift();

		if (next === undefined) {
			void this.#render(infobar);
			return;
		}

		slot.current = next;

		if (slot.timer !== null) clearTimeout(slot.timer);
		slot.timer = setTimeout(() => {
			slot.timer = null;
			slot.current = null;
			this.#advance(infobar);
		}, ALERT_DURATION_MS[next.kind]);

		void this.#render(infobar);
	}

	// --- Voile de rappel des coupures ----------------------------------------

	/**
	 * Coupure de l'utilisateur courant, ou `null`.
	 *
	 * Deduit du roster et non d'un evenement : l'etat est ainsi juste des la
	 * connexion, meme si le micro etait deja coupe avant.
	 */
	#cutKind(participants: readonly Participant[], selfId: string | null): CutKind | null {
		if (selfId === null) return null;

		const me = participants.find((participant) => participant.id === selfId);
		if (me === undefined) return null;

		if (me.selfDeaf || me.serverDeaf) return "deafen";
		if (me.selfMute || me.serverMute || me.suppressed) return "mute";
		return null;
	}

	/** Demarre le cycle si besoin. Sans effet s'il tourne deja. */
	#ensureFlashing(infobar: InfobarTarget, id: string): void {
		const slot = this.#flashFor(id);
		if (slot.cycleTimer !== null) return;

		// Le cycle est arme avant la premiere impulsion : sinon l'impulsion
		// redemanderait un demarrage et on empilerait les minuteries.
		slot.cycleTimer = setInterval(() => this.#pulse(infobar, id), FLASH_CYCLE_MS);
		this.#pulse(infobar, id);
	}

	/** Une impulsion : voile visible une seconde, puis eteint. */
	#pulse(infobar: InfobarTarget, id: string): void {
		const slot = this.#flashFor(id);
		slot.on = true;
		void this.#render(infobar);

		if (slot.onTimer !== null) clearTimeout(slot.onTimer);
		slot.onTimer = setTimeout(() => {
			slot.onTimer = null;
			slot.on = false;
			void this.#render(infobar);
		}, FLASH_ON_MS);
	}

	#stopFlash(id: string): void {
		const slot = this.flashes.get(id);
		if (slot === undefined) return;

		if (slot.onTimer !== null) clearTimeout(slot.onTimer);
		if (slot.cycleTimer !== null) clearInterval(slot.cycleTimer);
		slot.onTimer = null;
		slot.cycleTimer = null;
		slot.on = false;
	}

	#flashFor(id: string): FlashSlot {
		const existing = this.flashes.get(id);
		if (existing !== undefined) return existing;

		const created: FlashSlot = { on: false, onTimer: null, cycleTimer: null };
		this.flashes.set(id, created);
		return created;
	}

	// --- Rendu ---------------------------------------------------------------

	/** Construit la charge utile complete, puis n'envoie que ce qui a change. */
	async #render(infobar: InfobarTarget): Promise<void> {
		const state = this.lastState.get(infobar.id);
		if (state === undefined) return;

		const payload = await this.#buildPayload(infobar, state);

		const previous = this.lastSent.get(infobar.id) ?? {};
		const delta: FeedbackPayload = {};
		let changed = false;

		for (const [key, value] of Object.entries(payload)) {
			if (!sameItem(previous[key], value)) {
				delta[key] = value;
				changed = true;
			}
		}

		if (!changed) return;

		this.lastSent.set(infobar.id, payload);

		try {
			await infobar.setFeedback(delta);
		} catch (error) {
			this.logger.error(`Mise a jour de l'Infobar impossible : ${String(error)}`);
		}
	}

	async #buildPayload(
		infobar: InfobarTarget,
		state: VoicePresenceState
	): Promise<Record<string, ItemState>> {
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

		if (showAvatars) {
			const visible = participants.slice(0, SLOTS);
			const start = this.#startSlot(visible.length);
			const avatars = voicePresence.avatars;

			for (const [index, participant] of visible.entries()) {
				const slot = start + index;

				const dataUrl =
					avatars === null ? null : await avatars.get(participant.id, participant.avatarHash);
				payload[`avatar${slot}`] = { value: dataUrl ?? AVATAR_PLACEHOLDER, opacity: 1 };
				payload[`frame${slot}`] = {
					value: participant.speaking ? FRAME_SPEAKING : FRAME,
					opacity: 1
				};

				const badge = this.#badgeOf(participant);
				payload[`badge${slot}`] =
					badge === null ? { value: "", opacity: 0 } : { value: badge, opacity: 1 };
			}
		}

		await this.#applyAlert(payload, infobar.id, state, showAvatars);
		const flashing = this.#applyFlash(payload, infobar, participants, state.selfId);

		// Le texte centre est au-dessus du voile : on le vide pour qu'il ne
		// s'affiche pas par-dessus.
		if (flashing) {
			payload["status"] = "";
			payload["detail"] = "";
		}

		return payload;
	}

	/**
	 * Ajoute le voile de rappel, ou l'eteint et arrete le cycle.
	 *
	 * Renvoie vrai si le voile est actuellement visible.
	 */
	#applyFlash(
		payload: Record<string, ItemState>,
		infobar: InfobarTarget,
		participants: readonly Participant[],
		selfId: string | null
	): boolean {
		const kind = this.#cutKind(participants, selfId);

		if (kind === null) {
			this.#stopFlash(infobar.id);
			payload["flashBg"] = { value: "", opacity: 0 };
			payload["flashBar"] = { value: "", opacity: 0 };
			payload["flashIcon"] = { value: "", opacity: 0 };
			payload["flashText"] = "";
			return false;
		}

		this.#ensureFlashing(infobar, infobar.id);
		const visible = this.#flashFor(infobar.id).on;
		const opacity = visible ? 1 : 0;

		payload["flashBg"] = { value: `imgs/infobar/flash-bg-${kind}.svg`, opacity };
		payload["flashBar"] = { value: "imgs/infobar/flash-bar.svg", opacity };
		payload["flashIcon"] = { value: `imgs/infobar/flash-icon-${kind}.svg`, opacity };
		payload["flashText"] = visible ? FLASH_MESSAGE[kind] : "";

		return visible;
	}

	/** Ajoute la surcouche d'annonce, ou la masque et remet le texte d'etat. */
	async #applyAlert(
		payload: Record<string, ItemState>,
		id: string,
		state: VoicePresenceState,
		showAvatars: boolean
	): Promise<void> {
		const alert = this.alerts.get(id)?.current ?? null;

		if (alert === null) {
			payload["alertBg"] = { value: "", opacity: 0 };
			payload["alertAccent"] = { value: "", opacity: 0 };
			payload["alertAvatar"] = { value: "", opacity: 0 };
			payload["alertFrame"] = { value: FRAME, opacity: 0 };
			payload["alertTitle"] = "";
			payload["alertDetail"] = "";

			// Le texte centre sert aux etats sans avatars.
			if (showAvatars) {
				payload["status"] = "";
				payload["detail"] = "";
			} else {
				payload["status"] = this.#statusLine(state);
				payload["detail"] = this.#detailLine(state);
			}
			return;
		}

		payload["alertBg"] = { value: "imgs/infobar/alert-bg.svg", opacity: 1 };
		payload["alertAccent"] = { value: `imgs/infobar/accent-${alert.kind}.svg`, opacity: 1 };

		if (alert.kind === "channel") {
			// Pas d'avatar : le texte centre suffit, et evite un trou a gauche.
			payload["alertAvatar"] = { value: "", opacity: 0 };
			payload["alertFrame"] = { value: FRAME, opacity: 0 };
			payload["alertTitle"] = "";
			payload["alertDetail"] = "";
			payload["status"] = alert.channel;
			payload["detail"] = alert.guild ?? "";
			return;
		}

		const dataUrl = await this.#alertAvatar(alert.participant);
		payload["alertAvatar"] = { value: dataUrl ?? AVATAR_PLACEHOLDER, opacity: 1 };
		payload["alertFrame"] = { value: `imgs/infobar/frame-${alert.kind}.svg`, opacity: 1 };
		payload["alertTitle"] = alert.participant.name;
		payload["alertDetail"] = ALERT_DETAIL[alert.kind];
		payload["status"] = "";
		payload["detail"] = "";
	}

	async #alertAvatar(participant: Participant): Promise<string | null> {
		const avatars = voicePresence.avatars;
		return avatars === null ? null : avatars.get(participant.id, participant.avatarHash);
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

/** Libelle affiche sous le nom, par type d'annonce. */
const ALERT_DETAIL: Record<Exclude<VoiceAlert["kind"], "channel">, string> = {
	joined: "a rejoint le vocal",
	left: "a quitte le vocal"
};

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
