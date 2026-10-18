/**
 * Service de presence vocale.
 *
 * Un seul point de verite pour tout le plugin : il maintient la connexion au RPC
 * Discord, s'authentifie, suit le salon vocal, et diffuse l'etat aux actions
 * abonnees. Les actions ne parlent jamais directement a Discord.
 *
 * La connexion est ouverte a la demande (premiere action placee) et fermee
 * quand plus aucune action n'est presente, pour ne pas garder un processus
 * connecte inutilement.
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

/** Delais entre deux tentatives, du plus court au plus long. */
const RECONNECT_DELAYS_MS = [15_000, 30_000, 60_000, 120_000];

/**
 * Delai avant de fermer la connexion quand plus aucune action n'est abonnee.
 *
 * Stream Deck redemande `willAppear` lors d'un changement de profil ou d'une
 * modification de l'action. Fermer la connexion a chaque fois provoquerait une
 * rafale de reconnexions, et Discord n'en accepte que deux par minute.
 */
const STOP_GRACE_MS = 3_000;

export type VoicePresenceStatus = "connecting" | "ready" | "error";

export interface VoicePresenceState {
	status: VoicePresenceStatus;
	/** Message destine a l'utilisateur, en cas d'erreur. */
	message: string | null;
	/** Identifiant Discord de l'utilisateur courant, pour le reconnaitre dans le roster. */
	selfId: string | null;
	/** Nom du salon vocal, ou `null` hors vocal. */
	channel: string | null;
	/** Nom du serveur, quand il est connu. */
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
 * Evenement transitoire a annoncer quelques secondes.
 *
 * Les coupures de micro et de casque n'en font pas partie : elles ne sont pas
 * annoncees une fois mais rappelees en continu tant qu'elles durent, et l'action
 * deduit cet etat du roster plutot que d'un evenement.
 */
export type VoiceAlert =
	| { kind: "joined"; participant: Participant }
	| { kind: "left"; participant: Participant }
	| { kind: "channel"; channel: string; guild: string | null };

type Listener = (state: VoicePresenceState) => void;
type AlertListener = (alert: VoiceAlert) => void;

/**
 * Rend un echec de connexion comprehensible pour l'utilisateur.
 *
 * Le detail technique reste dans le journal : l'Infobar n'a que deux lignes.
 */
function explain(message: string): string {
  if (message.includes("pipe Discord joignable")) return "Lance le client Discord";
  if (message.includes("READY")) return "Discord ne repond pas, nouvel essai automatique";
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
	/** Identifiant de l'utilisateur courant, connu apres la connexion. */
	#selfId: string | null = null;
	#starting = false;
	#stopped = false;
	#authorizing = false;
	#retryTimer: NodeJS.Timeout | null = null;
	#stopTimer: NodeJS.Timeout | null = null;
	#reconnectAttempts = 0;

	/** Cache d'avatars, disponible une fois la connexion etablie. */
	get avatars(): AvatarCache | null {
		return this.#avatars;
	}

	get state(): VoicePresenceState {
		return this.#state;
	}

	/** S'abonne aux changements d'etat ; renvoie la fonction de desabonnement. */
	subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);

		// Une nouvelle arrivee annule l'extinction programmee : sinon un simple
		// willAppear redemande par Stream Deck couperait puis rouvrirait la
		// connexion Discord.
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

	/** Ferme la connexion si personne ne se reabonne entre-temps. */
	#scheduleStop(): void {
		if (this.#stopTimer !== null) return;

		this.#stopTimer = setTimeout(() => {
			this.#stopTimer = null;
			if (this.#listeners.size === 0) this.#stop();
		}, STOP_GRACE_MS);
		this.#stopTimer.unref();
	}

	/** S'abonne aux evenements transitoires (arrivees, departs, coupures). */
	onAlert(listener: AlertListener): () => void {
		this.#alertListeners.add(listener);
		return () => {
			this.#alertListeners.delete(listener);
		};
	}

	/**
	 * Force une nouvelle autorisation.
	 *
	 * Le jeton enregistre est efface, puis le consentement est redemande : c'est
	 * la seule facon de rouvrir la fenetre d'autorisation de Discord, qui n'est
	 * proposee qu'une fois par autorisation accordee.
	 */
	async reauthorize(): Promise<void> {
		if (this.#authorizing) {
			log.warn("Une autorisation est deja en cours.");
			return;
		}

		this.#authorizing = true;
		log.info("Nouvelle autorisation demandee.");
		this.#teardown();

		try {
			await this.#store.clear();
			this.#publish({ ...INITIAL, status: "connecting" });
			await this.#start();
		} finally {
			this.#authorizing = false;
		}
	}

	// --- Cycle de vie --------------------------------------------------------

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
				log.info(`${participant.name} a rejoint.`);
				this.#emitAlert({ kind: "joined", participant });
			});
			monitor.on("left", (participant) => {
				log.info(`${participant.name} a quitte.`);
				this.#emitAlert({ kind: "left", participant });
			});

			ipc.on("close", (reason) => {
				log.warn(`Connexion Discord perdue (${reason}).`);
				this.#scheduleReconnect();
			});

			await monitor.start();
			this.#monitor = monitor;
			this.#reconnectAttempts = 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`Connexion a Discord impossible : ${message}`);
			this.#publish({ ...this.#state, status: "error", message: explain(message) });
			this.#scheduleReconnect();
		} finally {
			this.#starting = false;
		}
	}

	/** Ferme la connexion sans arreter le service (une reconnexion peut suivre). */
	#teardown(): void {
		if (this.#retryTimer !== null) {
			clearTimeout(this.#retryTimer);
			this.#retryTimer = null;
		}

		this.#ipc?.close();
		this.#ipc = null;
		this.#monitor = null;
		this.#avatars = null;
	}

	#stop(): void {
		this.#stopped = true;

		if (this.#stopTimer !== null) {
			clearTimeout(this.#stopTimer);
			this.#stopTimer = null;
		}

		this.#reconnectAttempts = 0;
		this.#teardown();
		this.#state = INITIAL;
	}

	#scheduleReconnect(): void {
		if (this.#retryTimer !== null || this.#stopped || this.#listeners.size === 0) return;

		this.#ipc = null;
		this.#monitor = null;
		this.#avatars = null;

		// Delai croissant : Discord n'accepte que deux connexions par minute, donc
		// reessayer trop vite entretient l'echec au lieu de le resoudre.
		const index = Math.min(this.#reconnectAttempts, RECONNECT_DELAYS_MS.length - 1);
		const delay = RECONNECT_DELAYS_MS[index] ?? 120_000;
		this.#reconnectAttempts += 1;

		log.warn(`Nouvel essai dans ${Math.round(delay / 1000)} s.`);

		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = null;
			if (this.#listeners.size > 0) void this.#start();
		}, delay);
		this.#retryTimer.unref();
	}

	// --- Etat ----------------------------------------------------------------

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

		// Annonce du salon rejoint : c'est le seul moment ou son nom est utile.
		if (channel !== null) {
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
