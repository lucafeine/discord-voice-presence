/**
 * Discord RPC types, limited to what we need.
 *
 * Reference: https://docs.discord.food/topics/rpc
 *
 * Note: the Discord client sometimes serializes these objects with its internal
 * representation (camelCase, extra or missing fields) rather than the API
 * structure. We therefore stay tolerant.
 */

export type Snowflake = string;

export interface RpcUser {
  id: Snowflake;
  username: string;
  discriminator: string;
  global_name?: string | null;
  /** Avatar hash, or `null` if the user keeps the default avatar. */
  avatar?: string | null;
  avatar_decoration_data?: { asset: string; sku_id: Snowflake } | null;
  bot: boolean;
  flags?: number;
  public_flags?: number;
  premium_type?: number;
}

/** Voice state as seen by the client (server mute/deaf, suppression...). */
export interface RpcRemoteVoiceState {
  mute: boolean;
  deaf: boolean;
  self_mute: boolean;
  self_deaf: boolean;
  suppress: boolean;
}

/** A `voice_states` entry from `GET_SELECTED_VOICE_CHANNEL`. */
export interface RpcVoiceState {
  nick: string;
  /** *Local* mute (your own volume is muted, invisible to others). */
  mute: boolean;
  volume: number;
  pan: { left: number; right: number };
  voice_state: RpcRemoteVoiceState;
  user: RpcUser;
}

export interface RpcChannel {
  id: Snowflake;
  name: string;
  type: number;
  topic?: string;
  bitrate?: number;
  user_limit?: number;
  guild_id?: Snowflake | null;
  position?: number;
  /** People currently in the channel. */
  voice_states?: RpcVoiceState[];
}

export interface RpcGuild {
  id: Snowflake;
  name: string;
  icon_url?: string | null;
}

/** `GET_IMAGE` response. */
export interface RpcImage {
  data_url: string;
}

export interface SpeakingEvent {
  channel_id: Snowflake;
  user_id: Snowflake;
}

export interface VoiceChannelSelectEvent {
  channel_id: Snowflake | null;
  guild_id?: Snowflake | null;
}

/**
 * Internal model: what rendering needs, independently of the exact shape
 * returned by Discord.
 */
export interface Participant {
  id: Snowflake;
  /** Display name: guild nickname if present, else global name, else username. */
  name: string;
  username: string;
  avatarHash: string | null;
  avatarDecorationAsset: string | null;
  isBot: boolean;
  /** Self-muted (microphone off). */
  selfMute: boolean;
  /** Self-deafened (cannot hear). */
  selfDeaf: boolean;
  /** Server-muted. */
  serverMute: boolean;
  /** Server-deafened. */
  serverDeaf: boolean;
  /** Permission to speak removed. */
  suppressed: boolean;
  /** Currently speaking (SPEAKING_* events). */
  speaking: boolean;
}
