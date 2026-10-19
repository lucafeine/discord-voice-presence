/**
 * Discord local IPC protocol client.
 *
 * Discord exposes an RPC server over a named pipe (`discord-ipc-0` to `-9`).
 * The protocol is binary: each message is preceded by an 8-byte header
 * (opcode + body length, two 32-bit little-endian integers), and the body is
 * UTF-8 encoded JSON.
 *
 * Reference: https://docs.discord.food/topics/rpc
 */

import net from "node:net";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { log } from "./log.js";

// --- Opcodes ------------------------------------------------------------------
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const PIPE_COUNT = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const PIPE_CONNECT_TIMEOUT_MS = 2_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;

// --- Types --------------------------------------------------------------------

export class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(`RPC ${code}: ${message}`);
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

/** Current user, as provided by READY. */
export interface SelfUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface DiscordIpcEvents {
  /** Client `DISPATCH` and `SUBSCRIBE` events, including READY. */
  event: [message: IpcMessage];
  /** The socket was closed, cleanly or not. */
  close: [reason: string];
  /** Non-fatal socket error. */
  error: [error: Error];
}

export interface DiscordIpcOptions {
  clientId: string;
  /** Maximum wait for an RPC response, in milliseconds. */
  timeoutMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

// --- Pipe resolution ----------------------------------------------------------

function pipeCandidates(): string[] {
  if (process.platform === "win32") {
    // In JS, "\\\\.\\pipe\\x" yields `\\.\pipe\x`.
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
 * Attempts a connection and resolves with the open socket.
 *
 * We connect directly instead of probing then reconnecting: the Discord RPC
 * allows only 2 connections per minute, so every connection must count. A
 * missing pipe fails immediately (ENOENT) without ever reaching Discord, and
 * therefore does not consume that quota.
 */
function tryConnect(pipePath: string, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: pipePath });
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();

      if (error === undefined) {
        resolve(socket);
      } else {
        socket.destroy();
        reject(error);
      }
    };

    const timer = setTimeout(
      () => finish(new Error(`Connection timed out (${timeoutMs} ms)`)),
      timeoutMs,
    );
    timer.unref();

    socket.once("connect", () => finish());
    socket.once("error", (error: Error) => finish(error));
  });
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
   * READY event payload.
   *
   * READY arrives during `connect()` and would therefore be missed by a
   * listener attached afterwards, so it is kept here.
   */
  get readyPayload(): ReadyPayload | null {
    return this.#readyPayload;
  }

  /** Discord user of the current session. */
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

  /**
   * Opens the first reachable pipe, sends the handshake, and waits for READY.
   *
   * Only one connection is opened at a time to preserve the RPC quota.
   */
  async connect(): Promise<void> {
    const socket = await this.#openFirstPipe();
    log.info(`Discord pipe: ${this.#pipePath}`);

    this.#socket = socket;
    this.#buffer = Buffer.alloc(0);
    this.#closing = false;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#readySettle = null;

        // Without this close, the socket stays open: it would keep counting
        // against Discord's connection quota (2 per minute), and every failed
        // attempt would make the next one harder. Listeners are removed first
        // so the "close" event is not emitted and a closure is not published
        // again.
        socket.removeAllListeners();
        socket.destroy();
        this.#socket = null;

        reject(new Error(`No READY response after ${HANDSHAKE_TIMEOUT_MS} ms.`));
      }, HANDSHAKE_TIMEOUT_MS);
      timer.unref();

      socket.on("error", (error) => this.emit("error", error));
      socket.on("close", () => this.#handleClose("socket closed"));
      socket.on("data", (chunk: Buffer) => this.#onData(chunk));

      this.#ready = new Promise<void>((readyResolve, readyReject) => {
        this.#readySettle = {
          resolve: () => {
            clearTimeout(timer);
            readyResolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            readyReject(error);
          },
        };
      });

      this.#writeFrame(OP_HANDSHAKE, { v: 1, client_id: this.#clientId });
      this.#ready.then(resolve, reject);
    });
  }

  async #openFirstPipe(): Promise<net.Socket> {
    const candidates = pipeCandidates();

    for (const candidate of candidates) {
      try {
        const socket = await tryConnect(candidate, PIPE_CONNECT_TIMEOUT_MS);
        this.#pipePath = candidate;
        return socket;
      } catch {
        // Missing pipe: try the next one.
      }
    }

    throw new Error(
      "No Discord pipe reachable (discord-ipc-0 to -9). " +
        "Check that the Discord client is running and signed in.",
    );
  }

  /**
   * Sends an RPC command and resolves with its `data` field.
   *
   * `timeoutMs` allows extra time for commands that wait for user action, such
   * as AUTHORIZE (consent window).
   */
  call<T = unknown>(
    cmd: string,
    args?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    return this.#request<T>({ cmd, args }, timeoutMs);
  }

  /**
   * Subscribes to an event.
   *
   * The event name goes in the payload's `evt` field, not in `args` (see the
   * outgoing packet structure of the protocol).
   */
  subscribe(evt: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.#request({ cmd: "SUBSCRIBE", args, evt });
  }

  unsubscribe(evt: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.#request({ cmd: "UNSUBSCRIBE", args, evt });
  }

  /** Closes the connection cleanly. */
  close(): void {
    this.#closing = true;
    const socket = this.#socket;
    if (socket === null) return;

    try {
      this.#writeFrame(OP_CLOSE, { code: 1000, message: "Intentional close" });
    } catch {
      // The socket may already be dead: ignore.
    }

    socket.end();
    socket.destroy();
    this.#handleClose("intentional close");
  }

  // --- Internal ---------------------------------------------------------------

  #request<T>(payload: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const nonce = randomUUID();
    const timeout = timeoutMs ?? this.#timeoutMs;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(nonce);
        reject(new Error(`Timed out (${timeout} ms) for ${String(payload["cmd"])}`));
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
      throw new Error("The Discord IPC client is not connected.");
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
      this.#handleClose("the Discord client requested the close");
      return;
    }

    if (op !== OP_FRAME) {
      log.warn(`Unexpected IPC opcode: ${op}`);
      return;
    }

    let message: IpcMessage;
    try {
      message = JSON.parse(body.toString("utf8")) as IpcMessage;
    } catch {
      log.warn("Unreadable JSON frame, ignored");
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
          pending.reject(new RpcError(data?.code ?? 1000, data?.message ?? "unknown error"));
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
    ready?.reject(new Error(`Connection closed before READY (${reason}).`));

    const error = new Error(`Discord IPC connection closed: ${reason}`);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();

    if (!this.#closing) this.emit("close", reason);
  }
}
