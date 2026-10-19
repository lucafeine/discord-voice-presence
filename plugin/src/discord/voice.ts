/**
 * Tracks the current voice channel.
 *
 * Two sources are combined:
 *   - `GET_SELECTED_VOICE_CHANNEL` for the initial state (participant list);
 *   - event subscriptions for instant updates, with no polling.
 *
 * `VOICE_STATE_*` subscriptions require a `channel_id`, so subscribing is only
 * possible after fetching the channel, and every channel change requires a new
 * subscription.
 */

import { EventEmitter } from "node:events";
import type { DiscordIpc, IpcMessage } from "./ipc.js";
import { log } from "./log.js";
import type {
  Participant,
  RpcChannel,
  RpcGuild,
  RpcUser,
  RpcVoiceState,
  Snowflake,
  SpeakingEvent,
  VoiceChannelSelectEvent,
} from "./types.js";

const VOICE_STATE_EVENTS = [
  "VOICE_STATE_CREATE",
  "VOICE_STATE_DELETE",
  "VOICE_STATE_UPDATE",
] as const;

const SPEAKING_EVENTS = ["SPEAKING_START", "SPEAKING_STOP"] as const;

const VOICE_CHANNEL_SELECT = "VOICE_CHANNEL_SELECT";

/**
 * Time during which leaves are ignored after a channel change.
 *
 * Discord sends a `VOICE_STATE_DELETE` for the old channel when switching. Without
 * this window, every channel change would show a false "left" popup for people
 * who did not move.
 */
const CHANNEL_TRANSITION_GRACE_MS = 1_500;

// --- Discord object helpers ---------------------------------------------------

/**
 * Display name: guild nickname if present, else global name, else username.
 *
 * Since Discord removed discriminators, `username` is no longer unique for
 * display: `global_name` is the right default.
 */
export function displayName(user: RpcUser, nick?: string | null): string {
  const trimmedNick = nick?.trim();
  if (trimmedNick !== undefined && trimmedNick !== "") return trimmedNick;

  const globalName = user.global_name?.trim();
  if (globalName !== undefined && globalName !== "") return globalName;

  return user.username;
}

/**
 * Default avatar index, for accounts without an image.
 *
 * New formula (recent accounts): `(id >> 22) % 6`.
 */
export function defaultAvatarIndex(userId: Snowflake): number {
  return Number((BigInt(userId) >> 22n) % 6n);
}

/**
 * Avatar CDN URL.
 *
 * Always request PNG: for an animated avatar (`a_...`), the CDN returns a
 * still image, which is enough for a pixmap.
 */
export function avatarUrl(user: Pick<RpcUser, "id" | "avatar">, size = 128): string {
  if (typeof user.avatar === "string" && user.avatar !== "") {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=${size}`;
  }
  return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex(user.id)}.png`;
}

export function toParticipant(voiceState: RpcVoiceState, speaking = false): Participant {
  const user = voiceState.user;
  const remote = voiceState.voice_state;

  return {
    id: user.id,
    name: displayName(user, voiceState.nick),
    username: user.username,
    avatarHash: user.avatar ?? null,
    avatarDecorationAsset: user.avatar_decoration_data?.asset ?? null,
    isBot: user.bot === true,
    selfMute: remote?.self_mute === true,
    selfDeaf: remote?.self_deaf === true,
    serverMute: remote?.mute === true,
    serverDeaf: remote?.deaf === true,
    suppressed: remote?.suppress === true,
    speaking,
  };
}

// --- Monitor -----------------------------------------------------------------

export interface VoiceMonitorEvents {
  /** The participant list changed. */
  update: [participants: Participant[], channel: RpcChannel | null];
  /** Someone joined the channel. */
  joined: [participant: Participant];
  /** Someone left the channel. */
  left: [participant: Participant];
  /** Someone started speaking. */
  speaking: [participant: Participant];
  /** Someone stopped speaking. */
  stoppedSpeaking: [participant: Participant];
  /** The current channel changed (or voice was left). */
  channel: [channel: RpcChannel | null];
}

export class VoiceMonitor extends EventEmitter<VoiceMonitorEvents> {
  readonly #ipc: DiscordIpc;
  #channel: RpcChannel | null = null;
  #participants = new Map<Snowflake, Participant>();
  #subscribedChannelId: Snowflake | null = null;
  #listening = false;
  #transitioning = false;
  #transitionTimer: NodeJS.Timeout | null = null;

  constructor(ipc: DiscordIpc) {
    super();
    this.#ipc = ipc;
  }

  get channel(): RpcChannel | null {
    return this.#channel;
  }

  get participants(): Participant[] {
    return [...this.#participants.values()];
  }

  /** Attaches events then loads the current state. */
  async start(): Promise<void> {
    if (!this.#listening) {
      this.#ipc.on("event", (message) => {
        void this.#onEvent(message);
      });
      this.#listening = true;
    }

    // `VOICE_CHANNEL_SELECT` does NOT depend on the current channel and must
    // therefore be subscribed here, once and for all. Subscribing to it along
    // with channel events meant never listening to it when the plugin started
    // outside voice: it could then no longer learn that a channel was joined.
    await this.#trySubscribe(VOICE_CHANNEL_SELECT, undefined);

    await this.refresh();
  }

  /** Re-reads the channel state from Discord. */
  async refresh(): Promise<void> {
    const channel = await this.#ipc.call<RpcChannel | null>("GET_SELECTED_VOICE_CHANNEL");
    await this.#applyChannel(channel);
  }

  /** Guild name, for display. Best-effort. */
  async guildName(channel: RpcChannel | null): Promise<string | null> {
    const guildId = channel?.guild_id;
    if (channel === null || guildId === null || guildId === undefined) return null;

    try {
      const guild = await this.#ipc.call<RpcGuild>("GET_GUILD", { guild_id: guildId });
      return guild?.name ?? null;
    } catch (error) {
      log.warn(`GET_GUILD failed: ${(error as Error).message}`);
      return null;
    }
  }

  // --- Interne ---------------------------------------------------------------

  async #applyChannel(channel: RpcChannel | null): Promise<void> {
    const nextId = channel?.id ?? null;
    const previousId = this.#subscribedChannelId;
    const changed = nextId !== previousId;

    if (changed) {
      // A transition only makes sense when leaving a channel we were subscribed
      // to: that is the only case where Discord sends DELETE for the old
      // channel.
      if (previousId !== null) this.#beginTransition();
      if (previousId !== null) await this.#unsubscribe(previousId);
    }

    // Publish the new state BEFORE subscribing: while waiting for the
    // subscription, incoming messages are processed and would otherwise
    // publish an empty roster, making the display flicker to "Not in voice".
    this.#channel = channel;
    this.#subscribedChannelId = nextId;
    this.#rebuildParticipants(channel);

    if (changed) this.emit("channel", channel);
    this.emit("update", this.participants, channel);

    // Useful trace: without it, a missing channel subscription was invisible
    // in the log.
    if (changed) {
      log.info(
        channel === null
          ? "Not in voice: no channel selected."
          : `Current channel: ${channel.name}`
      );
    }

    if (changed && nextId !== null) await this.#subscribe(nextId);
  }

  /** Rebuilds the roster from Discord's response. */
  #rebuildParticipants(channel: RpcChannel | null): void {
    // Keep the "speaking" state: it is carried by events separate from the
    // participant list.
    const speakingIds = new Set(
      [...this.#participants.values()].filter((p) => p.speaking).map((p) => p.id),
    );

    this.#participants = new Map(
      (channel?.voice_states ?? []).map((voiceState) => [
        voiceState.user.id,
        toParticipant(voiceState, speakingIds.has(voiceState.user.id)),
      ]),
    );
  }

  /**
   * Marks the start of a channel change.
   *
   * `VOICE_STATE_DELETE` events received during this window concern the old
   * channel: they are not leaves, and are ignored.
   */
  #beginTransition(): void {
    this.#transitioning = true;
    if (this.#transitionTimer !== null) clearTimeout(this.#transitionTimer);

    this.#transitionTimer = setTimeout(() => {
      this.#transitioning = false;
      this.#transitionTimer = null;
      void this.#settle();
    }, CHANNEL_TRANSITION_GRACE_MS);
    this.#transitionTimer.unref();
  }

  /**
   * Re-requests the current state once the transition has passed.
   *
   * The roster is published from a snapshot taken BEFORE subscribing to events:
   * a member joining in that interval would be missed. This single re-request
   * closes the window.
   */
  async #settle(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      log.warn(`Cannot refresh after channel change: ${(error as Error).message}`);
    }
  }

  async #subscribe(channelId: Snowflake): Promise<void> {
    log.info(`Subscribing to channel ${channelId} events...`);
    const args = { channel_id: channelId };

    for (const evt of VOICE_STATE_EVENTS) {
      await this.#trySubscribe(evt, args);
    }

    for (const evt of SPEAKING_EVENTS) {
      // `channel_id` is optional for speaking events: on refusal, retry
      // without arguments.
      const ok = await this.#trySubscribe(evt, args);
      if (!ok) await this.#trySubscribe(evt, undefined);
    }
  }

  async #unsubscribe(channelId: Snowflake): Promise<void> {
    const args = { channel_id: channelId };
    for (const evt of [...VOICE_STATE_EVENTS, ...SPEAKING_EVENTS]) {
      try {
        await this.#ipc.unsubscribe(evt, args);
      } catch {
        // An unsubscribed event returns an error: not important here.
      }
    }
  }

  async #trySubscribe(evt: string, args: Record<string, unknown> | undefined): Promise<boolean> {
    try {
      await this.#ipc.subscribe(evt, args);
      return true;
    } catch (error) {
      log.warn(`Subscription ${evt} refused: ${(error as Error).message}`);
      return false;
    }
  }

  async #onEvent(message: IpcMessage): Promise<void> {
    const evt = message.evt;
    if (evt === null || evt === undefined) return;

    switch (evt) {
      case "VOICE_STATE_CREATE": {
        const voiceState = extractVoiceState(message.data);
        if (voiceState === null) return;
        const participant = toParticipant(voiceState);
        this.#participants.set(participant.id, participant);
        this.emit("joined", participant);
        this.emit("update", this.participants, this.#channel);
        return;
      }

      case "VOICE_STATE_UPDATE": {
        const voiceState = extractVoiceState(message.data);
        if (voiceState === null) return;
        const existing = this.#participants.get(voiceState.user.id);
        const participant = toParticipant(voiceState, existing?.speaking ?? false);
        this.#participants.set(participant.id, participant);
        this.emit("update", this.participants, this.#channel);
        return;
      }

      case "VOICE_STATE_DELETE": {
        const voiceState = extractVoiceState(message.data);
        if (voiceState === null) return;

        // During a channel change, DELETE events concern the old channel and
        // the roster will be rebuilt right after: processing them would empty
        // the display for an instant before it fills again.
        if (this.#transitioning) return;

        const participant = this.#participants.get(voiceState.user.id) ?? toParticipant(voiceState);
        this.#participants.delete(participant.id);
        this.emit("left", participant);
        this.emit("update", this.participants, this.#channel);
        return;
      }

      case "SPEAKING_START": {
        const speaking = message.data as SpeakingEvent | undefined;
        if (speaking?.user_id === undefined) return;
        const participant = this.#participants.get(speaking.user_id);
        if (participant === undefined) return;
        participant.speaking = true;
        this.emit("speaking", participant);
        this.emit("update", this.participants, this.#channel);
        return;
      }

      case "SPEAKING_STOP": {
        const speaking = message.data as SpeakingEvent | undefined;
        if (speaking?.user_id === undefined) return;
        const participant = this.#participants.get(speaking.user_id);
        if (participant === undefined) return;
        participant.speaking = false;
        this.emit("stoppedSpeaking", participant);
        this.emit("update", this.participants, this.#channel);
        return;
      }

      case VOICE_CHANNEL_SELECT: {
        const selection = message.data as VoiceChannelSelectEvent | undefined;

        // Mark the transition as soon as the event is received, before even
        // querying Discord: DELETE events for the old channel can arrive during
        // the request. A first channel (no previous one) is not a transition:
        // there is no old channel whose people would be leaving.
        if (this.#subscribedChannelId !== null) this.#beginTransition();

        log.info(
          selection?.channel_id === null || selection?.channel_id === undefined
            ? "You left voice."
            : `You joined a voice channel (${selection.channel_id}).`,
        );
        await this.refresh();
        return;
      }

      default:
        return;
    }
  }
}

/**
 * Extracts a voice state from an event payload.
 *
 * The Discord client sometimes wraps its objects (internal camelCase
 * representation): both forms are accepted rather than breaking.
 */
function extractVoiceState(data: unknown): RpcVoiceState | null {
  if (data === null || typeof data !== "object") return null;

  const candidate = data as { user?: unknown; voice_state?: unknown; voiceState?: unknown };
  if (candidate.user === undefined || typeof candidate.user !== "object") return null;

  const user = candidate.user as RpcUser;
  if (typeof user.id !== "string") return null;

  const raw = (candidate.voice_state ?? candidate.voiceState ?? {}) as Partial<RpcVoiceState["voice_state"]>;
  const nick = (data as { nick?: string }).nick;

  return {
    nick: nick ?? "",
    mute: false,
    volume: 100,
    pan: { left: 0, right: 0 },
    voice_state: {
      mute: raw.mute === true,
      deaf: raw.deaf === true,
      self_mute: raw.self_mute === true,
      self_deaf: raw.self_deaf === true,
      suppress: raw.suppress === true,
    },
    user,
  };
}
