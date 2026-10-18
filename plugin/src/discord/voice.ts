/**
 * Suivi du salon vocal courant.
 *
 * On combine deux sources :
 *   - `GET_SELECTED_VOICE_CHANNEL` pour l'etat initial (liste des participants) ;
 *   - des souscriptions aux evenements pour les mises a jour instantanees,
 *     sans aucun polling.
 *
 * Les souscriptions `VOICE_STATE_*` exigent un `channel_id`, donc on ne peut
 * souscrire qu'apres avoir recupere le salon, et il faut re-souscrire a chaque
 * changement de salon.
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
 * Duree pendant laquelle on ignore les departs apres un changement de salon.
 *
 * Discord envoie un `VOICE_STATE_DELETE` pour l'ancien salon quand on en change.
 * Sans cette fenetre, chaque changement de salon ferait apparaitre un faux
 * popup "a quitte" pour des personnes qui n'ont pas bouge.
 */
const CHANNEL_TRANSITION_GRACE_MS = 1_500;

// --- Helpers sur les objets Discord ------------------------------------------

/**
 * Nom a afficher : surnom de serveur s'il existe, sinon nom global, sinon le
 * nom d'utilisateur.
 *
 * Depuis que Discord a supprime les discriminants, `username` n'est plus unique
 * pour l'affichage : `global_name` est le bon choix par defaut.
 */
export function displayName(user: RpcUser, nick?: string | null): string {
  const trimmedNick = nick?.trim();
  if (trimmedNick !== undefined && trimmedNick !== "") return trimmedNick;

  const globalName = user.global_name?.trim();
  if (globalName !== undefined && globalName !== "") return globalName;

  return user.username;
}

/**
 * Index de l'avatar par defaut, pour les comptes sans image.
 *
 * Nouvelle formule (comptes recents) : `(id >> 22) % 6`.
 */
export function defaultAvatarIndex(userId: Snowflake): number {
  return Number((BigInt(userId) >> 22n) % 6n);
}

/**
 * URL CDN de l'avatar.
 *
 * On demande toujours du PNG : pour un avatar anime (`a_...`), le CDN renvoie
 * une image fixe, ce qui suffit pour un pixmap.
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
  /** La liste des participants a change. */
  update: [participants: Participant[], channel: RpcChannel | null];
  /** Quelqu'un a rejoint le salon. */
  joined: [participant: Participant];
  /** Quelqu'un a quitte le salon. */
  left: [participant: Participant];
  /** Quelqu'un a commence a parler. */
  speaking: [participant: Participant];
  /** Quelqu'un a arrete de parler. */
  stoppedSpeaking: [participant: Participant];
  /** Le salon courant a change (ou on a quitte le vocal). */
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

  /** Branche les evenements puis charge l'etat courant. */
  async start(): Promise<void> {
    if (!this.#listening) {
      this.#ipc.on("event", (message) => {
        void this.#onEvent(message);
      });
      this.#listening = true;
    }
    await this.refresh();
  }

  /** Relit l'etat du salon depuis Discord. */
  async refresh(): Promise<void> {
    const channel = await this.#ipc.call<RpcChannel | null>("GET_SELECTED_VOICE_CHANNEL");
    await this.#applyChannel(channel);
  }

  /** Nom du serveur, pour l'affichage. Best-effort. */
  async guildName(channel: RpcChannel | null): Promise<string | null> {
    const guildId = channel?.guild_id;
    if (channel === null || guildId === null || guildId === undefined) return null;

    try {
      const guild = await this.#ipc.call<RpcGuild>("GET_GUILD", { guild_id: guildId });
      return guild?.name ?? null;
    } catch (error) {
      log.warn(`GET_GUILD a echoue : ${(error as Error).message}`);
      return null;
    }
  }

  // --- Interne ---------------------------------------------------------------

  async #applyChannel(channel: RpcChannel | null): Promise<void> {
    const nextId = channel?.id ?? null;
    const previousId = this.#subscribedChannelId;
    const changed = nextId !== previousId;

    if (changed) {
      // Une transition n'a de sens que si l'on quitte un salon auquel on etait
      // abonne : c'est la seule situation ou Discord envoie des DELETE pour
      // l'ancien salon.
      if (previousId !== null) this.#beginTransition();
      if (previousId !== null) await this.#unsubscribe(previousId);
    }

    // On publie le nouvel etat AVANT de souscrire : pendant l'attente de la
    // souscription, les messages entrants sont traites et publieraient sinon un
    // roster encore vide, faisant clignoter l'affichage sur "Pas en vocal".
    this.#channel = channel;
    this.#subscribedChannelId = nextId;
    this.#rebuildParticipants(channel);

    if (changed) this.emit("channel", channel);
    this.emit("update", this.participants, channel);

    if (changed && nextId !== null) await this.#subscribe(nextId);
  }

  /** Reconstruit le roster depuis la reponse de Discord. */
  #rebuildParticipants(channel: RpcChannel | null): void {
    // On conserve l'etat "en train de parler" : il est porte par des evenements
    // distincts de la liste des participants.
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
   * Marque le debut d'un changement de salon.
   *
   * Les `VOICE_STATE_DELETE` recus pendant cette fenetre concernent l'ancien
   * salon : ce ne sont pas des departs, on les ignore.
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
   * Re-requete l'etat courant, une fois la transition passee.
   *
   * Le roster est publie depuis un instantane pris AVANT la souscription aux
   * evenements : un membre arrivant dans cet intervalle serait manque. Cette
   * re-requete unique referme la fenetre.
   */
  async #settle(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      log.warn(`Rafraichissement apres changement de salon impossible : ${(error as Error).message}`);
    }
  }

  async #subscribe(channelId: Snowflake): Promise<void> {
    log.info(`Souscription aux evenements du salon ${channelId}...`);
    const args = { channel_id: channelId };

    for (const evt of VOICE_STATE_EVENTS) {
      await this.#trySubscribe(evt, args);
    }

    for (const evt of SPEAKING_EVENTS) {
      // `channel_id` est optionnel pour les evenements de parole : en cas de
      // refus, on retente sans argument.
      const ok = await this.#trySubscribe(evt, args);
      if (!ok) await this.#trySubscribe(evt, undefined);
    }

    await this.#trySubscribe(VOICE_CHANNEL_SELECT, undefined);
  }

  async #unsubscribe(channelId: Snowflake): Promise<void> {
    const args = { channel_id: channelId };
    for (const evt of [...VOICE_STATE_EVENTS, ...SPEAKING_EVENTS]) {
      try {
        await this.#ipc.unsubscribe(evt, args);
      } catch {
        // Un evenement non souscrit renvoie une erreur : sans importance ici.
      }
    }
  }

  async #trySubscribe(evt: string, args: Record<string, unknown> | undefined): Promise<boolean> {
    try {
      await this.#ipc.subscribe(evt, args);
      return true;
    } catch (error) {
      log.warn(`Souscription ${evt} refusee : ${(error as Error).message}`);
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

        // Pendant un changement de salon, les DELETE concernent l'ancien salon et
        // le roster va etre reconstruit juste apres : les traiter viderait
        // l'affichage un instant avant qu'il ne se remplisse a nouveau.
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

        // Marque la transition des la reception de l'evenement, avant meme
        // d'interroger Discord : les DELETE de l'ancien salon peuvent arriver
        // pendant la requete. Un premier salon (aucun precedent) n'est pas une
        // transition : il n'y a pas d'ancien salon dont les gens partiraient.
        if (this.#subscribedChannelId !== null) this.#beginTransition();

        log.info(
          selection?.channel_id === null || selection?.channel_id === undefined
            ? "Tu as quitte le vocal."
            : `Tu as rejoint un salon vocal (${selection.channel_id}).`,
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
 * Recupere un etat vocal dans une charge utile d'evenement.
 *
 * Le client Discord enveloppe parfois ses objets (representation interne
 * camelCase) : on accepte les deux formes plutot que de casser.
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
