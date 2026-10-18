/**
 * Client du protocole IPC local de Discord.
 *
 * Discord expose un serveur RPC sur un named pipe (`discord-ipc-0` a `-9`).
 * Le protocole est binaire : chaque message est precede d'un en-tete de
 * 8 octets (opcode + taille du corps, deux entiers 32 bits little endian),
 * le corps etant du JSON encode en UTF-8.
 *
 * Reference : https://docs.discord.food/topics/rpc
 */

import net from "node:net";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { log } from "./log.ts";

// --- Opcodes -----------------------------------------------------------------
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const PIPE_COUNT = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const PIPE_PROBE_TIMEOUT_MS = 500;

// --- Types -------------------------------------------------------------------

export class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(`RPC ${code} : ${message}`);
    this.name = "RpcError";
    this.code = code;
  }
}

export interface IpcMessage {
  cmd?: string;
  data?: unknown;
  evt?: string | null;
  nonce?: string | null;
}

export interface ReadyPayload {
  v: number;
  config: { cdn_host: string; api_endpoint: string; environment: string };
  user: unknown;
}

/** Utilisateur courant, tel que fourni par READY. */
export interface SelfUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface DiscordIpcEvents {
  /** Les evenements `DISPATCH` et `SUBSCRIBE` du client (READY inclus). */
  event: [message: IpcMessage];
  /** Le socket a ete ferme, proprement ou non. */
  close: [reason: string];
  /** Erreur non fatale du socket. */
  error: [error: Error];
}

export interface DiscordIpcOptions {
  clientId: string;
  /** Delai maximal d'attente d'une reponse RPC, en millisecondes. */
  timeoutMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

// --- Resolution du pipe ------------------------------------------------------

function pipeCandidates(): string[] {
  if (process.platform === "win32") {
    // En JS, "\\\\.\\pipe\\x" donne `\\.\pipe\x`.
    return Array.from({ length: PIPE_COUNT }, (_, i) => `\\\\.\\pipe\\discord-ipc-${i}`);
  }
  const base =
    process.env["XDG_RUNTIME_DIR"] ??
    process.env["TMPDIR"] ??
    process.env["TMP"] ??
    process.env["TEMP"] ??
    "/tmp";
  return Array.from({ length: PIPE_COUNT }, (_, i) => path.join(base, `discord-ipc-${i}`));
}

/**
 * Teste si un pipe accepte une connexion.
 *
 * Les pipes inexistants echouent immediatement (ENOENT) sans jamais atteindre
 * Discord : ils ne consomment donc pas le quota de connexions du client.
 */
function probePipe(pipePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ path: pipePath });
    let settled = false;

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    const timer = setTimeout(() => finish(false), PIPE_PROBE_TIMEOUT_MS);
    timer.unref();
  });
}

/** Trouve le premier pipe Discord disponible. */
export async function findDiscordPipe(): Promise<string> {
  const candidates = pipeCandidates();
  for (const candidate of candidates) {
    if (await probePipe(candidate)) return candidate;
  }
  throw new Error(
    "Aucun pipe Discord trouve (discord-ipc-0 a -9). Verifie que le client Discord est lance et connecte.",
  );
}

// --- Client ------------------------------------------------------------------

export class DiscordIpc extends EventEmitter<DiscordIpcEvents> {
  readonly #clientId: string;
  readonly #timeoutMs: number;

  #socket: net.Socket | null = null;
  #buffer: Buffer = Buffer.alloc(0);
  #pending = new Map<string, Pending>();
  #ready: Promise<void> | null = null;
  #readySettle: { resolve: () => void; reject: (error: Error) => void } | null = null;
  #closing = false;
  #pipePath = "";
  #readyPayload: ReadyPayload | null = null;

  constructor(options: DiscordIpcOptions) {
    super();
    this.#clientId = options.clientId;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get pipePath(): string {
    return this.#pipePath;
  }

  /**
   * Charge utile de l'evenement READY.
   *
   * READY arrive pendant `connect()` et serait donc manque par un ecouteur
   * branche apres : on le conserve ici.
   */
  get readyPayload(): ReadyPayload | null {
    return this.#readyPayload;
  }

  /** Utilisateur Discord de la session en cours. */
  get selfUser(): SelfUser | null {
    const user = this.#readyPayload?.user;
    if (user === null || typeof user !== "object") return null;

    const candidate = user as Partial<SelfUser>;
    if (typeof candidate.id !== "string" || typeof candidate.username !== "string") return null;

    return {
      id: candidate.id,
      username: candidate.username,
      global_name: candidate.global_name ?? null,
      avatar: candidate.avatar ?? null,
    };
  }

  get connected(): boolean {
    return this.#socket !== null && !this.#socket.destroyed;
  }

  /** Ouvre le socket, envoie le handshake et attend l'evenement READY. */
  async connect(): Promise<void> {
    const pipePath = await findDiscordPipe();
    this.#pipePath = pipePath;
    log.info(`pipe Discord : ${pipePath}`);

    const socket = net.connect({ path: pipePath });
    this.#socket = socket;
    this.#buffer = Buffer.alloc(0);
    this.#closing = false;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        socket.destroy();
        reject(new Error(`Connexion au pipe Discord impossible : ${error.message}`));
      };
      socket.once("error", onError);

      socket.once("connect", () => {
        socket.off("error", onError);
        socket.on("error", (error) => this.emit("error", error));
        socket.on("close", () => this.#handleClose("socket ferme"));
        socket.on("data", (chunk: Buffer) => this.#onData(chunk));

        this.#ready = new Promise<void>((readyResolve, readyReject) => {
          this.#readySettle = { resolve: readyResolve, reject: readyReject };
        });

        this.#writeFrame(OP_HANDSHAKE, { v: 1, client_id: this.#clientId });
        this.#ready.then(resolve, reject);
      });
    });
  }

  /**
   * Envoie une commande RPC et resout avec son champ `data`.
   *
   * `timeoutMs` permet de laisser plus de temps aux commandes qui attendent une
   * action de l'utilisateur, comme AUTHORIZE (fenetre de consentement).
   */
  call<T = unknown>(
    cmd: string,
    args?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    return this.#request<T>({ cmd, args }, timeoutMs);
  }

  /**
   * Souscrit a un evenement.
   *
   * Le nom de l'evenement va dans le champ `evt` de la charge utile, pas dans
   * `args` (voir la structure des paquets sortants du protocole).
   */
  subscribe(evt: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.#request({ cmd: "SUBSCRIBE", args, evt });
  }

  unsubscribe(evt: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.#request({ cmd: "UNSUBSCRIBE", args, evt });
  }

  /** Ferme proprement la connexion. */
  close(): void {
    this.#closing = true;
    const socket = this.#socket;
    if (socket === null) return;

    try {
      this.#writeFrame(OP_CLOSE, { code: 1000, message: "Fermeture volontaire" });
    } catch {
      // Le socket est peut-etre deja mort : on ignore.
    }

    socket.end();
    socket.destroy();
    this.#handleClose("fermeture volontaire");
  }

  // --- Interne ---------------------------------------------------------------

  #request<T>(payload: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const nonce = randomUUID();
    const timeout = timeoutMs ?? this.#timeoutMs;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(nonce);
        reject(new Error(`Delai depasse (${timeout} ms) pour ${String(payload["cmd"])}`));
      }, timeout);
      timer.unref();

      this.#pending.set(nonce, { resolve: resolve as (value: unknown) => void, reject, timer });

      try {
        this.#writeFrame(OP_FRAME, { ...payload, nonce });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(nonce);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #writeFrame(op: number, payload: unknown): void {
    this.#writeRaw(op, Buffer.from(JSON.stringify(payload), "utf8"));
  }

  #writeRaw(op: number, body: Buffer): void {
    const socket = this.#socket;
    if (socket === null || socket.destroyed) {
      throw new Error("Le client IPC Discord n'est pas connecte.");
    }

    const header = Buffer.alloc(8);
    header.writeUInt32LE(op, 0);
    header.writeUInt32LE(body.length, 4);
    socket.write(Buffer.concat([header, body]));
  }

  #onData(chunk: Buffer): void {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);

    while (this.#buffer.length >= 8) {
      const op = this.#buffer.readUInt32LE(0);
      const length = this.#buffer.readUInt32LE(4);
      if (this.#buffer.length < 8 + length) return;

      const body = Buffer.from(this.#buffer.subarray(8, 8 + length));
      this.#buffer = this.#buffer.subarray(8 + length);
      this.#onFrame(op, body);
    }
  }

  #onFrame(op: number, body: Buffer): void {
    if (op === OP_PING) {
      this.#writeRaw(OP_PONG, body);
      return;
    }

    if (op === OP_CLOSE) {
      this.#handleClose("le client Discord a demande la fermeture");
      return;
    }

    if (op !== OP_FRAME) {
      log.warn(`opcode IPC inattendu : ${op}`);
      return;
    }

    let message: IpcMessage;
    try {
      message = JSON.parse(body.toString("utf8")) as IpcMessage;
    } catch {
      log.warn("trame JSON illisible, ignoree");
      return;
    }

    const nonce = message.nonce ?? null;
    if (nonce !== null) {
      const pending = this.#pending.get(nonce);
      if (pending !== undefined) {
        this.#pending.delete(nonce);
        clearTimeout(pending.timer);

        if (message.evt === "ERROR") {
          const data = message.data as { code?: number; message?: string } | undefined;
          pending.reject(new RpcError(data?.code ?? 1000, data?.message ?? "erreur inconnue"));
        } else {
          pending.resolve(message.data);
        }
        return;
      }
    }

    if (message.evt === "READY") {
      this.#readyPayload = message.data as ReadyPayload;
      this.#readySettle?.resolve();
      this.#readySettle = null;
    }

    this.emit("event", message);
  }

  #handleClose(reason: string): void {
    if (this.#socket === null) return;
    this.#socket.removeAllListeners();
    this.#socket = null;
    this.#buffer = Buffer.alloc(0);

    const ready = this.#readySettle;
    this.#readySettle = null;
    this.#ready = null;
    ready?.reject(new Error(`Connexion fermee avant READY (${reason}).`));

    const error = new Error(`Connexion IPC Discord fermee : ${reason}`);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();

    if (!this.#closing) this.emit("close", reason);
  }
}
