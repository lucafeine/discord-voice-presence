/**
 * Tests de `VoiceMonitor`, sans Discord et sans reseau.
 *
 * Ces tests couvrent le point le plus delicat de l'integration : Discord envoie
 * des `VOICE_STATE_DELETE` pour l'ancien salon quand on en change, ce qui
 * donnait un faux popup "a quitte" a chaque changement de salon. Ce cas, comme
 * son pendant (un vrai depart doit rester annonce), est difficile a reproduire
 * a la main : il faut plusieurs personnes en vocal au bon moment.
 *
 * Lancement : npm test
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DiscordIpc, IpcMessage } from "./ipc.ts";
import type { Participant, RpcChannel, RpcVoiceState } from "./types.ts";
import { VoiceMonitor } from "./voice.ts";

// --- Doublure du RPC --------------------------------------------------------

class FakeIpc {
  readonly #handlers: ((message: IpcMessage) => void)[] = [];
  /** Ce que renverra GET_SELECTED_VOICE_CHANNEL. */
  channel: RpcChannel | null = null;

  on(event: string, handler: (message: IpcMessage) => void): this {
    if (event === "event") this.#handlers.push(handler);
    return this;
  }

  async call(cmd: string): Promise<unknown> {
    if (cmd === "GET_SELECTED_VOICE_CHANNEL") return this.channel;
    return { name: "Serveur de test" };
  }

  async subscribe(): Promise<unknown> {
    return { evt: "ok" };
  }

  async unsubscribe(): Promise<unknown> {
    return { evt: "ok" };
  }

  /** Simule un evenement pousse par le client Discord. */
  dispatch(message: IpcMessage): void {
    for (const handler of this.#handlers) handler(message);
  }
}

function asIpc(fake: FakeIpc): DiscordIpc {
  return fake as unknown as DiscordIpc;
}

/** Laisse tourner la boucle d'evenements : les handlers sont asynchrones. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// --- Fabriques de donnees Discord -------------------------------------------

function voiceState(id: string, name: string): RpcVoiceState {
  return {
    nick: "",
    mute: false,
    volume: 100,
    pan: { left: 0, right: 0 },
    voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false, suppress: false },
    user: {
      id,
      username: name.toLowerCase(),
      discriminator: "0",
      global_name: name,
      avatar: null,
      bot: false,
    },
  };
}

function channel(id: string, members: readonly string[]): RpcChannel {
  return {
    id,
    name: `Salon ${id}`,
    type: 2,
    guild_id: "serveur",
    voice_states: members.map((name) => voiceState(name, name)),
  };
}

function monitorWith(channelOrNull: RpcChannel | null): {
  fake: FakeIpc;
  monitor: VoiceMonitor;
  left: Participant[];
  joined: Participant[];
} {
  const fake = new FakeIpc();
  fake.channel = channelOrNull;

  const monitor = new VoiceMonitor(asIpc(fake));
  const left: Participant[] = [];
  const joined: Participant[] = [];

  monitor.on("left", (participant) => left.push(participant));
  monitor.on("joined", (participant) => joined.push(participant));

  return { fake, monitor, left, joined };
}

// --- Tests ------------------------------------------------------------------

test("un depart tiers est annonce", async () => {
  const { fake, monitor, left } = monitorWith(channel("A", ["Alice", "Bob"]));
  await monitor.start();
  assert.equal(monitor.participants.length, 2);

  fake.dispatch({ evt: "VOICE_STATE_DELETE", data: voiceState("Bob", "Bob") });
  await flush();

  assert.equal(left.length, 1, "le depart de Bob doit etre annonce");
  assert.equal(left[0]?.name, "Bob");
  assert.equal(monitor.participants.length, 1);
});

test("un changement de salon n'annonce ni depart ni arrivee", async () => {
  const { fake, monitor, left, joined } = monitorWith(channel("A", ["Alice", "Bob"]));
  await monitor.start();

  // Discord annonce le nouveau salon, puis envoie les DELETE de l'ancien.
  fake.channel = channel("B", ["Alice", "Bob"]);
  fake.dispatch({ evt: "VOICE_CHANNEL_SELECT", data: { channel_id: "B", guild_id: "serveur" } });
  await flush();

  fake.dispatch({ evt: "VOICE_STATE_DELETE", data: voiceState("Alice", "Alice") });
  fake.dispatch({ evt: "VOICE_STATE_DELETE", data: voiceState("Bob", "Bob") });
  await flush();

  assert.equal(left.length, 0, "changer de salon ne doit pas annoncer de depart");
  assert.equal(joined.length, 0, "les membres deja presents ne doivent pas etre annonces");
  assert.equal(monitor.participants.length, 2, "le roster doit rester complet");
});

test("aucun roster vide n'est publie pendant un changement de salon", async () => {
  const { fake, monitor } = monitorWith(channel("A", ["Alice", "Bob"]));
  const sizes: number[] = [];
  monitor.on("update", (participants, activeChannel) => {
    if (activeChannel !== null) sizes.push(participants.length);
  });

  await monitor.start();

  fake.channel = channel("B", ["Alice", "Bob"]);
  fake.dispatch({ evt: "VOICE_CHANNEL_SELECT", data: { channel_id: "B", guild_id: "serveur" } });
  await flush();

  fake.dispatch({ evt: "VOICE_STATE_DELETE", data: voiceState("Alice", "Alice") });
  fake.dispatch({ evt: "VOICE_STATE_DELETE", data: voiceState("Bob", "Bob") });
  await flush();

  assert.ok(
    !sizes.includes(0),
    `un roster vide ne doit pas etre publie (tailles observees : ${sizes.join(", ")})`,
  );
});

test("quitter le vocal ne produit aucun popup de depart", async () => {
  const { fake, monitor, left } = monitorWith(channel("A", ["Alice", "Bob"]));
  await monitor.start();

  fake.channel = null;
  fake.dispatch({ evt: "VOICE_CHANNEL_SELECT", data: { channel_id: null, guild_id: null } });
  await flush();

  fake.dispatch({ evt: "VOICE_STATE_DELETE", data: voiceState("Alice", "Alice") });
  fake.dispatch({ evt: "VOICE_STATE_DELETE", data: voiceState("Bob", "Bob") });
  await flush();

  assert.equal(left.length, 0, "quitter le vocal n'est pas un depart a annoncer");
  assert.equal(monitor.participants.length, 0);
  assert.equal(monitor.channel, null);
});

test("une prise de parole bascule l'etat du participant", async () => {
  const { fake, monitor } = monitorWith(channel("A", ["Alice", "Bob"]));
  await monitor.start();

  const alice = (): Participant | undefined =>
    monitor.participants.find((participant) => participant.name === "Alice");

  fake.dispatch({ evt: "SPEAKING_START", data: { channel_id: "A", user_id: "Alice" } });
  await flush();
  assert.equal(alice()?.speaking, true);

  fake.dispatch({ evt: "SPEAKING_STOP", data: { channel_id: "A", user_id: "Alice" } });
  await flush();
  assert.equal(alice()?.speaking, false);
});

test("un arrivee est annoncee et le local est marque bot", async () => {
  const { fake, monitor, joined } = monitorWith(channel("A", ["Alice"]));
  await monitor.start();

  const casey = voiceState("Casey", "Casey");
  casey.user.bot = true;
  fake.dispatch({ evt: "VOICE_STATE_CREATE", data: casey });
  await flush();

  assert.equal(joined.length, 1);
  assert.equal(joined[0]?.name, "Casey");
  assert.equal(joined[0]?.isBot, true);
  assert.equal(monitor.participants.length, 2);
});

test("apres la fenetre de transition, un depart est de nouveau annonce", async () => {
  const { fake, monitor, left } = monitorWith(channel("A", ["Alice", "Bob"]));
  await monitor.start();

  fake.channel = channel("B", ["Alice", "Bob"]);
  fake.dispatch({ evt: "VOICE_CHANNEL_SELECT", data: { channel_id: "B", guild_id: "serveur" } });
  await flush();

  // La fenetre de transition dure 1,5 s : on la laisse expirer.
  await new Promise((resolve) => setTimeout(resolve, 1_800));

  fake.dispatch({ evt: "VOICE_STATE_DELETE", data: voiceState("Bob", "Bob") });
  await flush();

  assert.equal(left.length, 1, "un depart redevient annoncable une fois la transition finie");
  assert.equal(left[0]?.name, "Bob");
});
