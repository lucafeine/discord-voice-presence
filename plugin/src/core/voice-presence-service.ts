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

/** Delai avant nouvelle tentative quand Discord est injoignable. */
const RECONNECT_DELAY_MS = 15_000;

export type VoicePresenceStatus = "connecting" | "ready" | "error";

export interface VoicePresenceState {
	status: VoicePresenceStatus;
	/** Message destine a l'utilisateur, en cas d'erreur. */
	message: string | null;
	/** Nom du salon vocal, ou `null` hors vocal. */
	channel: string | null;
	/** Nom du serveur, quand il est connu. */
	guild: string | null;
	participants: Participant[];
}

const INITIAL: VoicePresenceState = {
	status: "connecting",
	message: null,
	channel: null,
	guild: null,
	participants: []
};

type Listener = (state: VoicePresenceState) => void;

export class VoicePresenceService {
	#state: VoicePresenceState = INITIAL;
	readonly #listeners = new Set<Listener>();
	readonly #store: TokenStore = new GlobalSettingsTokenStore();

	#ipc: DiscordIpc | null = null;
	#monitor: VoiceMonitor | null = null;
	#avatars: AvatarCache | null = null;
	#starting = false;
	#stopped = false;
	#authorizing = false;
	#retryTimer: NodeJS.Timeout | null = null;

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
		listener(this.#state);

		if (this.#listeners.size === 1) {
			void this.#start();
		}

		return () => {
			this.#listeners.delete(listener);
			if (this.#listeners.size === 0) {
				this.#stop();
			}
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

			const monitor = new VoiceMonitor(ipc);
			monitor.on("update", (participants, channel) => {
				this.#onRoster(participants, channel);
			});
			monitor.on("channel", (channel) => {
				void this.#onChannel(channel);
			});
			monitor.on("joined", (participant) => log.info(`${participant.name} a rejoint.`));
			monitor.on("left", (participant) => log.info(`${participant.name} a quitte.`));

			ipc.on("close", (reason) => {
				log.warn(`Connexion Discord perdue (${reason}).`);
				this.#scheduleReconnect();
			});

			await monitor.start();
			this.#monitor = monitor;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`Connexion a Discord impossible : ${message}`);
			this.#publish({ ...this.#state, status: "error", message });
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
		this.#teardown();
		this.#state = INITIAL;
	}

	#scheduleReconnect(): void {
		if (this.#retryTimer !== null || this.#stopped || this.#listeners.size === 0) return;

		this.#ipc = null;
		this.#monitor = null;
		this.#avatars = null;

		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = null;
			if (this.#listeners.size > 0) void this.#start();
		}, RECONNECT_DELAY_MS);
		this.#retryTimer.unref();
	}

	// --- Etat ----------------------------------------------------------------

	async #onChannel(channel: RpcChannel | null): Promise<void> {
		const guild = this.#monitor === null ? null : await this.#monitor.guildName(channel);

		this.#publish({
			...this.#state,
			status: "ready",
			message: null,
			channel: channel?.name ?? null,
			guild
		});
	}

	#onRoster(participants: Participant[], channel: RpcChannel | null): void {
		this.#publish({
			...this.#state,
			status: "ready",
			message: null,
			channel: channel?.name ?? null,
			participants
		});
	}

	#publish(state: VoicePresenceState): void {
		this.#state = state;
		for (const listener of this.#listeners) {
			listener(state);
		}
	}
}

export const voicePresence = new VoicePresenceService();
