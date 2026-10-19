/**
 * Voice presence service.
 *
 * The single source of truth for the plugin: it maintains the Discord RPC
 * connection, authenticates, tracks the voice channel, and broadcasts state to
 * subscribed actions. Actions never talk to Discord directly.
 *
 * The connection opens on demand (first placed action) and closes when no
 * actions remain, so a connection is not kept alive unnecessarily.
 */

import { ensureAuthenticated } from "../discord/auth.js";
import type { TokenStore } from "../discord/auth.js";
import { AvatarCache } from "../discord/avatars.js";
import { DISCORD_CLIENT_ID, DISCORD_SCOPES } from "../discord/constants.js";
import { DiscordIpc } from "../discord/ipc.js";
import { log } from "../discord/log.js";
import { GlobalSettingsTokenStore } from "../discord/settings.js";
import type { Participant, RpcChannel } from "../discord/types.js";
import { VoiceMonitor } from "../discord/voice.js";

/** Delays between attempts, from shortest to longest. */
const RECONNECT_DELAYS_MS = [15_000, 30_000, 60_000, 120_000];

/**
 * Delay before closing the connection when no actions remain subscribed.
 *
 * Stream Deck requests `willAppear` again on profile changes or action edits.
 * Closing the connection every time would cause a burst of reconnects, and
 * Discord allows only two per minute.
 */
const STOP_GRACE_MS = 3_000;

export type VoicePresenceStatus = "connecting" | "ready" | "error";

export interface VoicePresenceState {
	status: VoicePresenceStatus;
	/** User-facing message in case of an error. */
	message: string | null;
	/** Current user's Discord ID, used to recognize them in the roster. */
	selfId: string | null;
	/** Voice channel name, or `null` when not in voice. */
	channel: string | null;
	/** Guild name, when known. */
	guild: string | null;
	participants: Participant[];
}

const INITIAL: VoicePresenceState = {
	status: "connecting",
	message: null,
	selfId: null,
	channel: null,
	guild: null,
	participants: []
};

/**
 * Transient event to announce for a few seconds.
 *
 * Microphone and headset cuts are not part of it: they are not announced once
 * but recalled continuously while they last, and the action derives that state
 * from the roster rather than from an event.
 */
export type VoiceAlert =
	| { kind: "joined"; participant: Participant }
	| { kind: "left"; participant: Participant }
	| { kind: "channel"; channel: string; guild: string | null };

type Listener = (state: VoicePresenceState) => void;
type AlertListener = (alert: VoiceAlert) => void;

/**
 * Turns a connection failure into a user-friendly message.
 *
 * Technical details stay in the log: the Infobar only has two lines. Known
 * cases return a translation key; `#detailLine` resolves it at render time,
 * once the Stream Deck client language is known.
 */
function explain(message: string): string {
  if (message.includes("No Discord pipe reachable")) return "error.discordMissing";
  if (message.includes("READY")) return "error.discordUnresponsive";
  return message;
}

export class VoicePresenceService {
	#state: VoicePresenceState = INITIAL;
	readonly #listeners = new Set<Listener>();
	readonly #alertListeners = new Set<AlertListener>();
	readonly #store: TokenStore = new GlobalSettingsTokenStore();

	#ipc: DiscordIpc | null = null;
	#monitor: VoiceMonitor | null = null;
	#avatars: AvatarCache | null = null;
	/** Current user ID, known after connection. */
	#selfId: string | null = null;

	/**
	 * True once the channel has been announced.
	 *
	 * The channel name is useful only when discovering where you are: repeating
	 * it on every channel change occupies the screen for nothing, while avatars
	 * are the useful information.
	 */
	#channelAnnounced = false;
	#starting = false;
	#stopped = false;
	#authorizing = false;
	#retryTimer: NodeJS.Timeout | null = null;
	#stopTimer: NodeJS.Timeout | null = null;
	#reconnectAttempts = 0;

	/** Avatar cache, available once the connection is established. */
	get avatars(): AvatarCache | null {
		return this.#avatars;
	}

	get state(): VoicePresenceState {
		return this.#state;
	}

	/** Subscribes to state changes; returns the unsubscribe function. */
	subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);

		// A new subscriber cancels the scheduled shutdown: otherwise a simple
		// willAppear requested again by Stream Deck would close then reopen the
		// Discord connection.
		if (this.#stopTimer !== null) {
			clearTimeout(this.#stopTimer);
			this.#stopTimer = null;
		}

		listener(this.#state);

		if (this.#listeners.size === 1) {
			void this.#start();
		}

		return () => {
			this.#listeners.delete(listener);
			if (this.#listeners.size === 0) {
				this.#scheduleStop();
			}
		};
	}

	/** Closes the connection if nobody subscribes again in the meantime. */
	#scheduleStop(): void {
		if (this.#stopTimer !== null) return;

		this.#stopTimer = setTimeout(() => {
			this.#stopTimer = null;
			if (this.#listeners.size === 0) this.#stop();
		}, STOP_GRACE_MS);
		this.#stopTimer.unref();
	}

	/** Subscribes to transient events (joins, leaves, cuts). */
	onAlert(listener: AlertListener): () => void {
		this.#alertListeners.add(listener);
		return () => {
			this.#alertListeners.delete(listener);
		};
	}

	/**
	 * Forces a new authorization.
	 *
	 * The stored token is cleared, then consent is requested again: this is the
	 * only way to reopen Discord's authorization window, which is offered only
	 * once per granted authorization.
	 */
	async reauthorize(): Promise<void> {
		if (this.#authorizing) {
			log.warn("An authorization is already in progress.");
			return;
		}

		this.#authorizing = true;
		log.info("New authorization requested.");
		this.#teardown();

		try {
			await this.#store.clear();
			this.#publish({ ...INITIAL, status: "connecting" });
			await this.#start();
		} finally {
			this.#authorizing = false;
		}
	}

	// --- Lifecycle ------------------------------------------------------------

	async #start(): Promise<void> {
		if (this.#starting || this.#ipc !== null) return;

		this.#starting = true;
		this.#stopped = false;

		try {
			const ipc = new DiscordIpc({ clientId: DISCORD_CLIENT_ID });
			await ipc.connect();

			await ensureAuthenticated(ipc, this.#store, {
				clientId: DISCORD_CLIENT_ID,
				scopes: DISCORD_SCOPES
			});

			if (this.#stopped) {
				ipc.close();
				return;
			}

			this.#ipc = ipc;
			this.#avatars = new AvatarCache(ipc);
			this.#selfId = ipc.selfUser?.id ?? null;

			const monitor = new VoiceMonitor(ipc);
			monitor.on("update", (participants, channel) => {
				this.#onRoster(participants, channel);
			});
			monitor.on("channel", (channel) => {
				void this.#onChannel(channel);
			});
			monitor.on("joined", (participant) => {
				log.info(`${participant.name} joined.`);

				// You are already announced by the channel name: a popup on top
				// would duplicate what you just did.
				if (participant.id === this.#selfId) return;
				this.#emitAlert({ kind: "joined", participant });
			});

			monitor.on("left", (participant) => {
				log.info(`${participant.name} left.`);
				if (participant.id === this.#selfId) return;
				this.#emitAlert({ kind: "left", participant });
			});

			ipc.on("close", (reason) => {
				log.warn(`Discord connection lost (${reason}).`);
				this.#scheduleReconnect();
			});

			await monitor.start();
			this.#monitor = monitor;
			this.#reconnectAttempts = 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`Cannot connect to Discord: ${message}`);
			this.#publish({ ...this.#state, status: "error", message: explain(message) });
			this.#scheduleReconnect();
		} finally {
			this.#starting = false;
		}
	}

	/** Closes the connection without stopping the service (a reconnect may follow). */
	#teardown(): void {
		if (this.#retryTimer !== null) {
			clearTimeout(this.#retryTimer);
			this.#retryTimer = null;
		}

		this.#ipc?.close();
		this.#ipc = null;
		this.#monitor = null;
		this.#avatars = null;
		// A reconnect grants another channel announcement: it is a discovery
		// again.
		this.#channelAnnounced = false;
	}

	#stop(): void {
		this.#stopped = true;

		if (this.#stopTimer !== null) {
			clearTimeout(this.#stopTimer);
			this.#stopTimer = null;
		}

		this.#reconnectAttempts = 0;
		this.#channelAnnounced = false;
		this.#teardown();
		this.#state = INITIAL;
	}

	#scheduleReconnect(): void {
		if (this.#retryTimer !== null || this.#stopped || this.#listeners.size === 0) return;

		this.#ipc = null;
		this.#monitor = null;
		this.#avatars = null;

		// Increasing delay: Discord allows only two connections per minute, so
		// retrying too fast sustains the failure instead of solving it.
		const index = Math.min(this.#reconnectAttempts, RECONNECT_DELAYS_MS.length - 1);
		const delay = RECONNECT_DELAYS_MS[index] ?? 120_000;
		this.#reconnectAttempts += 1;

		log.warn(`Retrying in ${Math.round(delay / 1000)} s.`);

		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = null;
			if (this.#listeners.size > 0) void this.#start();
		}, delay);
		this.#retryTimer.unref();
	}

	// --- State ---------------------------------------------------------------

	async #onChannel(channel: RpcChannel | null): Promise<void> {
		const guild = this.#monitor === null ? null : await this.#monitor.guildName(channel);

		this.#publish({
			...this.#state,
			status: "ready",
			message: null,
			selfId: this.#selfId,
			channel: channel?.name ?? null,
			guild
		});

		// Channel announcement: once per connection. Repeating it on every
		// channel change would hide the avatars without teaching anything.
		if (channel !== null && !this.#channelAnnounced) {
			this.#channelAnnounced = true;
			this.#emitAlert({ kind: "channel", channel: channel.name, guild });
		}
	}

	#onRoster(participants: Participant[], channel: RpcChannel | null): void {
		this.#publish({
			...this.#state,
			status: "ready",
			message: null,
			selfId: this.#selfId,
			channel: channel?.name ?? null,
			participants
		});
	}

	#emitAlert(alert: VoiceAlert): void {
		for (const listener of this.#alertListeners) {
			listener(alert);
		}
	}

	#publish(state: VoicePresenceState): void {
		this.#state = state;
		for (const listener of this.#listeners) {
			listener(state);
		}
	}
}

export const voicePresence = new VoicePresenceService();
