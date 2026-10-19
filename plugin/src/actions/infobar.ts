import streamDeck, {
	action,
	SingletonAction,
	type DidReceiveSettingsEvent,
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
import { DEFAULT_BACKGROUND, GRID_SLOTS, VISIBLE_SLOTS, centeredStart } from "../infobar/theme.js";
import { ensureTheme, type ThemeFiles } from "../infobar/theme-writer.js";
import type { Participant } from "../discord/types.js";

const LAYOUT = "layouts/voice-presence.json";

const BADGE_MUTE = "imgs/infobar/badge-mute.svg";
const BADGE_DEAF = "imgs/infobar/badge-deafen.svg";
const AVATAR_PLACEHOLDER = "imgs/infobar/avatar-placeholder.svg";

/**
 * Scroll period when there are too many people.
 *
 * Slow enough to recognize faces, and two updates per cycle, far below the
 * guidelines' limit of 10 per second.
 */
const SCROLL_INTERVAL_MS = 3_000;

/**
 * Settings exposed in the Property Inspector.
 *
 * Serves as documentation: the SDK types settings as `JsonObject`, whose index
 * constraint makes that type unusable as a `SingletonAction` parameter.
 */
interface Settings {
	backgroundColor?: string;
}

/** Number of slots defined in the layout. */
const SLOTS = GRID_SLOTS;

/** Display duration of each alert, in milliseconds. */
const ALERT_DURATION_MS: Record<VoiceAlert["kind"], number> = {
	joined: 3500,
	left: 3500,
	channel: 3000
};

/**
 * Cut reminder: an opaque veil for as long as it lasts.
 *
 * It only concerns YOUR own state: hiding the row in a loop because another
 * participant is cut would be unbearable.
 *
 * Durations chosen to leave time to read the whole sentence: "You are deafened"
 * is 16 characters, one second was not enough. Two updates per cycle, far below
 * the guidelines' limit of 10 per second.
 */
const FLASH_ON_MS = 2_500;
const FLASH_CYCLE_MS = 7_500;

/** Translates a key loaded from the locale files (en, fr, es). */
const t = (key: string): string => streamDeck.i18n.translate(key);

/** Beyond this, drop: better to miss an announcement than to fall behind. */
const MAX_QUEUE = 4;

interface InfobarTarget {
	readonly id: string;
	setFeedbackLayout(layout: string): Promise<void>;
	setFeedback(feedback: FeedbackPayload): Promise<void>;
}

type ItemState = Pixmap | string;

/** Most severe cut present in the channel. */
type CutKind = "mute" | "deafen";

/** Alert queue state for an action. */
interface AlertSlot {
	queue: VoiceAlert[];
	current: VoiceAlert | null;
	timer: NodeJS.Timeout | null;
}

/** Reminder veil state for an action. */
interface FlashSlot {
	/** True while the veil is visible. */
	on: boolean;
	onTimer: NodeJS.Timeout | null;
	cycleTimer: NodeJS.Timeout | null;
}

/**
 * Infobar action: display only, no interaction.
 *
 * Avatars are square images clipped to a circle by an overlaid frame (see
 * tools/generate-infobar.mjs): no pixel is manipulated here.
 *
 * Join and leave announcements are an overlay of the SAME layout, not a second
 * layout: changing layout on every event would require a round trip and make
 * the display flicker.
 */
@action({ UUID: "com.lucas.discord-voice-presence.infobar" })
export class VoicePresenceInfobar extends SingletonAction {
	private readonly logger = streamDeck.logger.createScope("action.infobar");
	private readonly subscriptions = new Map<string, () => void>();
	private readonly alertSubscriptions = new Map<string, () => void>();

	/** Background color chosen in the Property Inspector, per action. */
	private readonly themes = new Map<string, ThemeFiles>();

	/** Last state sent per action, so only changes are sent. */
	private readonly lastSent = new Map<string, Record<string, ItemState>>();

	/** Last known state, used to redraw when an alert starts or ends. */
	private readonly lastState = new Map<string, VoicePresenceState>();

	private readonly alerts = new Map<string, AlertSlot>();
	private readonly flashes = new Map<string, FlashSlot>();

	/** Scroll window offset, per action. */
	private readonly scrollOffsets = new Map<string, number>();
	private readonly scrollTimers = new Map<string, NodeJS.Timeout>();

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isNeoInfobar()) {
			this.logger.warn("Action placed outside a Neo Infobar: ignored.");
			return;
		}

		const infobar: InfobarTarget = ev.action;
		this.#forget(infobar.id);
		this.themes.set(infobar.id, ensureTheme(ev.payload.settings.backgroundColor));

		try {
			// The layout must be (re)defined on every appearance: Stream Deck
			// does not keep this setting between sessions.
			await infobar.setFeedbackLayout(LAYOUT);
		} catch (error) {
			this.logger.error(`Cannot set the layout: ${String(error)}`);
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

	/**
	 * Color changed from the Property Inspector.
	 *
	 * PI components save as soon as the value changes, so there is no Save
	 * button: this event is the only signal.
	 */
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
		if (!ev.action.isNeoInfobar()) return;

		const infobar: InfobarTarget = ev.action;
		this.themes.set(infobar.id, ensureTheme(ev.payload.settings.backgroundColor));

		// Asset paths change with the color, so the comparison below detects the
		// change and returns the new card.
		void this.#render(infobar);
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
		this.#stopScroll(id);
		this.themes.delete(id);

		this.lastSent.delete(id);
		this.lastState.delete(id);
	}

	// --- Alert queue ---------------------------------------------------------

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
			this.logger.warn(`Alert queue full, ${alert.kind} ignored.`);
			return;
		}

		slot.queue.push(alert);
		this.#advance(infobar);
	}

	/** Advances to the next alert, or returns to the row when there is none. */
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

	// --- Cut reminder veil ---------------------------------------------------

	/**
	 * Current user's cut, or `null`.
	 *
	 * Derived from the roster rather than an event: the state is therefore
	 * correct from connection time, even if the microphone was already muted.
	 */
	#cutKind(participants: readonly Participant[], selfId: string | null): CutKind | null {
		if (selfId === null) return null;

		const me = participants.find((participant) => participant.id === selfId);
		if (me === undefined) return null;

		if (me.selfDeaf || me.serverDeaf) return "deafen";
		if (me.selfMute || me.serverMute || me.suppressed) return "mute";
		return null;
	}

	/** Starts the cycle when needed. No effect if it is already running. */
	#ensureFlashing(infobar: InfobarTarget, id: string): void {
		const slot = this.#flashFor(id);
		if (slot.cycleTimer !== null) return;

		// The cycle is armed before the first pulse: otherwise the pulse would
		// request another start and timers would pile up.
		slot.cycleTimer = setInterval(() => this.#pulse(infobar, id), FLASH_CYCLE_MS);
		this.#pulse(infobar, id);
	}

	/** One pulse: veil visible for a moment, then off. */
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

	// --- Scrolling -----------------------------------------------------------

	/** Current scroll window offset. */
	#scrollOffset(id: string): number {
		return this.scrollOffsets.get(id) ?? 0;
	}

	/** Starts scrolling when needed. No effect if it is already running. */
	#syncScroll(infobar: InfobarTarget, scrolling: boolean): void {
		const id = infobar.id;

		if (!scrolling) {
			this.#stopScroll(id);
			return;
		}

		if (this.scrollTimers.has(id)) return;

		const timer = setInterval(() => {
			const count = this.lastState.get(id)?.participants.length ?? 0;

			if (count <= VISIBLE_SLOTS) {
				this.#stopScroll(id);
				return;
			}

			this.scrollOffsets.set(id, (this.#scrollOffset(id) + 1) % count);
			void this.#render(infobar);
		}, SCROLL_INTERVAL_MS);

		this.scrollTimers.set(id, timer);
	}

	#stopScroll(id: string): void {
		const timer = this.scrollTimers.get(id);
		if (timer !== undefined) {
			clearInterval(timer);
			this.scrollTimers.delete(id);
		}

		// Returning to the start avoids resuming in the middle when people return.
		this.scrollOffsets.delete(id);
	}

	#flashFor(id: string): FlashSlot {
		const existing = this.flashes.get(id);
		if (existing !== undefined) return existing;

		const created: FlashSlot = { on: false, onTimer: null, cycleTimer: null };
		this.flashes.set(id, created);
		return created;
	}

	// --- Rendering -----------------------------------------------------------

	/** Builds the full payload, then sends only what changed. */
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
			this.logger.error(`Cannot update the Infobar: ${String(error)}`);
		}
	}

	async #buildPayload(
		infobar: InfobarTarget,
		state: VoicePresenceState
	): Promise<Record<string, ItemState>> {
		const payload: Record<string, ItemState> = {};
		const theme = this.themes.get(infobar.id) ?? ensureTheme(DEFAULT_BACKGROUND);

		// The card carries the color chosen in the Property Inspector.
		payload["card"] = { value: theme.card, opacity: 1 };

		// Every slot is always described: otherwise an avatar stays visible
		// after the person leaves.
		for (let slot = 0; slot < SLOTS; slot += 1) {
			payload[`avatar${slot}`] = { value: "", opacity: 0 };
			payload[`frame${slot}`] = { value: theme.frame, opacity: 0 };
			payload[`badge${slot}`] = { value: "", opacity: 0 };
		}

		const participants = state.participants;
		const showAvatars = state.status === "ready" && state.channel !== null && participants.length > 0;

		if (showAvatars) {
			// Beyond the window, scroll. The window is then left-aligned to sweep
			// the whole row; otherwise the row is centered.
			const scrolling = participants.length > VISIBLE_SLOTS;
			const visible = scrolling
				? scrollWindow(participants, this.#scrollOffset(infobar.id))
				: participants;
			const start = scrolling ? 0 : this.#startSlot(visible.length);
			const avatars = voicePresence.avatars;

			for (const [index, participant] of visible.entries()) {
				// Occupied positions advance by a full slot, while the grid
				// advances by half: hence the step of 2.
				const slot = start + index * 2;

				const dataUrl =
					avatars === null ? null : await avatars.get(participant.id, participant.avatarHash);
				payload[`avatar${slot}`] = { value: dataUrl ?? AVATAR_PLACEHOLDER, opacity: 1 };
				payload[`frame${slot}`] = {
					value: participant.speaking ? theme.frameSpeaking : theme.frame,
					opacity: 1
				};

				const badge = this.#badgeOf(participant);
				payload[`badge${slot}`] =
					badge === null ? { value: "", opacity: 0 } : { value: badge, opacity: 1 };
			}

			this.#syncScroll(infobar, scrolling);
		} else {
			this.#stopScroll(infobar.id);
		}

		await this.#applyAlert(payload, infobar.id, state, showAvatars, theme);
		const flashing = this.#applyFlash(payload, infobar, participants, state.selfId);

		// The centered text is above the veil: clear it so it does not appear
		// on top of it.
		if (flashing) {
			payload["status"] = "";
			payload["detail"] = "";
		}

		return payload;
	}

	/**
	 * Adds the reminder veil, or turns it off and stops the cycle.
	 *
	 * Returns true when the veil is currently visible.
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
		payload["flashText"] = visible ? t(`flash.${kind}`) : "";

		return visible;
	}

/** Adds the announcement overlay, or hides it and restores the status text. */
	async #applyAlert(
		payload: Record<string, ItemState>,
		id: string,
		state: VoicePresenceState,
		showAvatars: boolean,
		theme: ThemeFiles
	): Promise<void> {
		const alert = this.alerts.get(id)?.current ?? null;

		if (alert === null) {
			payload["alertBg"] = { value: "", opacity: 0 };
			payload["alertAccent"] = { value: "", opacity: 0 };
			payload["alertAvatar"] = { value: "", opacity: 0 };
			payload["alertFrame"] = { value: theme.frame, opacity: 0 };
			payload["alertTitle"] = "";
			payload["channelName"] = "";
			payload["alertDetail"] = "";

			// The centered text is used for states without avatars.
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
			// The channel name alone, large: no avatar, so no gap on the left,
			// and no guild name competing with it.
			payload["alertAvatar"] = { value: "", opacity: 0 };
			payload["alertFrame"] = { value: theme.frame, opacity: 0 };
			payload["alertTitle"] = "";
			payload["channelName"] = "";
			payload["alertDetail"] = "";
			payload["status"] = "";
			payload["detail"] = "";
			payload["channelName"] = alert.channel;
			return;
		}

		const dataUrl = await this.#alertAvatar(alert.participant);
		payload["alertAvatar"] = { value: dataUrl ?? AVATAR_PLACEHOLDER, opacity: 1 };
		payload["alertFrame"] = { value: `imgs/infobar/frame-${alert.kind}.svg`, opacity: 1 };
		payload["alertTitle"] = alert.participant.name;
		payload["alertDetail"] = t(`alert.${alert.kind}`);
		payload["status"] = "";
		payload["detail"] = "";
	}

	async #alertAvatar(participant: Participant): Promise<string | null> {
		const avatars = voicePresence.avatars;
		return avatars === null ? null : avatars.get(participant.id, participant.avatarHash);
	}

	/** Starting slot, used to center the row when it is short. */
	#startSlot(count: number): number {
		return centeredStart(count);
	}

	/** Badge to display, or `null`. The headset wins: it also mutes the mic. */
	#badgeOf(participant: Participant): string | null {
		if (participant.selfDeaf || participant.serverDeaf) return BADGE_DEAF;
		if (participant.selfMute || participant.serverMute || participant.suppressed) return BADGE_MUTE;
		return null;
	}

	#statusLine(state: VoicePresenceState): string {
		if (state.status === "error") return t("status.error");
		if (state.status === "connecting") return t("status.connecting");
		if (state.channel === null) return t("status.notInVoice");
		return t("status.emptyChannel");
	}

	#detailLine(state: VoicePresenceState): string {
		if (state.status === "error") {
			return state.message === null ? t("detail.errorFallback") : t(state.message);
		}
		if (state.status === "connecting") return t("detail.connecting");
		if (state.channel === null) return t("detail.notInVoice");
		return [state.guild, state.channel].filter((part) => part !== null).join(" · ");
	}
}

/**
 * Circular window of `VISIBLE_SLOTS` participants.
 *
 * Circular rather than linear: the last ones wrap to the beginning, so nobody
 * disappears from the display.
 */
function scrollWindow(participants: readonly Participant[], offset: number): Participant[] {
	if (participants.length <= VISIBLE_SLOTS) return [...participants];

	return Array.from(
		{ length: VISIBLE_SLOTS },
		(_, index) => participants[(offset + index) % participants.length]!
	);
}

/**
 * Two items are identical when their value and opacity are identical.
 *
 * Comparing strings directly is enough: the avatar cache returns the same data
 * URI instance until the avatar changes, so no expensive comparison over tens
 * of kilobytes is needed.
 */
function sameItem(previous: ItemState | undefined, next: ItemState): boolean {
	if (previous === next) return true;
	if (typeof previous === "string" || typeof next === "string") return previous === next;
	if (previous === undefined) return false;

	return previous.value === next.value && previous.opacity === next.opacity;
}
