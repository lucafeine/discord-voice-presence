/**
 * Types du RPC Discord, limites a ce dont on a besoin.
 *
 * Reference : https://docs.discord.food/topics/rpc
 *
 * Attention : le client Discord serialise parfois ces objets avec sa
 * representation interne (camelCase, champs supplementaires ou manquants)
 * plutot qu'avec la structure de l'API. On reste donc tolerant.
 */

export type Snowflake = string;

export interface RpcUser {
  id: Snowflake;
  username: string;
  discriminator: string;
  global_name?: string | null;
  /** Hash d'avatar, ou `null` si l'utilisateur garde l'avatar par defaut. */
  avatar?: string | null;
  avatar_decoration_data?: { asset: string; sku_id: Snowflake } | null;
  bot: boolean;
  flags?: number;
  public_flags?: number;
  premium_type?: number;
}

/** Etat vocal tel que vu par le client (mute/deaf serveur, suppression...). */
export interface RpcRemoteVoiceState {
  mute: boolean;
  deaf: boolean;
  self_mute: boolean;
  self_deaf: boolean;
  suppress: boolean;
}

/** Une entree `voice_states` de `GET_SELECTED_VOICE_CHANNEL`. */
export interface RpcVoiceState {
  nick: string;
  /** Mute *local* (c'est ton volume a toi qui est coupe, invisible pour les autres). */
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
  /** Les personnes presentes dans le salon. */
  voice_states?: RpcVoiceState[];
}

export interface RpcGuild {
  id: Snowflake;
  name: string;
  icon_url?: string | null;
}

/** Reponse de `GET_IMAGE`. */
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
 * Modele interne : ce dont le rendu a besoin, independamment de la forme
 * exacte renvoyee par Discord.
 */
export interface Participant {
  id: Snowflake;
  /** Nom affiche : surnom de serveur si present, sinon nom global, sinon username. */
  name: string;
  username: string;
  avatarHash: string | null;
  avatarDecorationAsset: string | null;
  isBot: boolean;
  /** Mute par lui-meme (micro coupe). */
  selfMute: boolean;
  /** Casque coupe (n'entend pas). */
  selfDeaf: boolean;
  /** Mute par le serveur. */
  serverMute: boolean;
  /** Deafen par le serveur. */
  serverDeaf: boolean;
  /** Permission de parler retiree. */
  suppressed: boolean;
  /** Est en train de parler (evenements SPEAKING_*). */
  speaking: boolean;
}
