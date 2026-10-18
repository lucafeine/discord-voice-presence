/**
 * Prototype en ligne de commande.
 *
 * Objectif de cette phase : valider toute la partie Discord (autorisation,
 * lecture du salon, evenements) et le rendu de l'Infobar *avant* d'ecrire le
 * plugin Stream Deck.
 *
 *   npm run smoke              connectivite IPC, sans autorisation
 *   npm run auth               consentement OAuth, une seule fois
 *   npm run status             etat du salon vocal courant
 *   npm run watch              suivi en direct des arrivees/departs/paroles
 *   npm run preview            planche de rendu (donnees factices par defaut)
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AvatarStore, decodeDataUrl } from "./avatars.ts";
import { ensureAuthenticated } from "./auth.ts";
import type { AuthOptions } from "./auth.ts";
import { AUTH_FILE, AVATAR_DIR, OUT_DIR, loadConfig, warnAboutPortalSetup } from "./config.ts";
import type { Config } from "./config.ts";
import { FakeAvatarStore, fakeParticipants } from "./fake.ts";
import { DiscordIpc } from "./ipc.ts";
import { log } from "./log.ts";
import * as render from "./render.ts";
import type { AvatarSource, ContactSheetEntry } from "./render.ts";
import type { Participant } from "./types.ts";
import { VoiceMonitor } from "./voice.ts";

/**
 * Identifiant d'application publique, utilise uniquement par `smoke` quand
 * aucune application personnelle n'est encore configuree. Il ne sert qu'a
 * verifier la connexion : aucune commande authentifiee ne peut etre appelee.
 */
const FALLBACK_CLIENT_ID = "367827983903490050";

// --- Utilitaires -------------------------------------------------------------

function authOptions(config: Config): AuthOptions {
  return {
    clientId: config.clientId,
    scopes: config.scopes,
  };
}

async function connect(config: Config, clientId = config.clientId): Promise<DiscordIpc> {
  const ipc = new DiscordIpc({ clientId });
  await ipc.connect();
  return ipc;
}

function describe(participant: Participant): string {
  const states: string[] = [];
  if (participant.speaking) states.push("parle");
  if (participant.selfDeaf || participant.serverDeaf) states.push("casque coupe");
  if (participant.selfMute || participant.serverMute) states.push("micro coupe");
  if (participant.suppressed) states.push("sourdine serveur");
  if (participant.isBot) states.push("bot");
  return states.length === 0 ? " " : states.join(", ");
}

function printParticipants(monitor: VoiceMonitor): void {
  const channel = monitor.channel;
  const participants = monitor.participants;

  if (channel === null) {
    log.info("Aucun salon vocal selectionne.");
    return;
  }

  log.info(`Salon : ${channel.name}  (${participants.length} participant(s))`);
  for (const participant of participants) {
    const mark = participant.speaking ? "*" : " ";
    process.stderr.write(
      `  ${mark} ${participant.name.padEnd(20)} ${describe(participant).trimEnd()}  [${participant.id}]\n`,
    );
  }
}

function ensureOutDir(): string {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  return OUT_DIR;
}

function withSpeaking(participants: readonly Participant[], index: number): Participant[] {
  return participants.map((participant, position) => ({
    ...participant,
    speaking: position === index,
  }));
}

function openFile(file: string): void {
  // `start` est une commande interne de cmd.exe : on passe par lui pour ouvrir
  // le fichier avec l'application par defaut.
  execFile("cmd", ["/c", "start", "", file], (error) => {
    if (error !== null) log.warn(`Ouverture impossible : ${error.message}`);
  });
}

// --- Planche de rendu --------------------------------------------------------

async function buildContactSheet(
  source: AvatarSource,
  participants: readonly Participant[],
  channelName: string | null,
): Promise<ContactSheetEntry[]> {
  const entries: ContactSheetEntry[] = [];
  const first = participants[0];
  const last = participants.at(-1);

  /** Enregistre l'etat et trace l'avancement : la composition prend un instant. */
  const add = (label: string, png: Buffer): void => {
    entries.push({ label, png });
    log.info(`  etat ${String(entries.length).padStart(2, "0")} : ${label}`);
  };

  add("Aucun participant", await render.renderIdle());

  if (first !== undefined) {
    add(
      "1 participant, en train de parler",
      await render.renderVoice({
        participants: withSpeaking([first], 0),
        avatarSource: source,
        channelName,
      }),
    );
  }

  if (participants.length >= 2) {
    add(
      `${Math.min(participants.length, 2)} participants (nom + nom du salon)`,
      await render.renderVoice({
        participants: participants.slice(0, 2),
        avatarSource: source,
        channelName,
      }),
    );
  }

  const visible = participants.slice(0, render.MAX_VISIBLE);
  if (visible.length > 2) {
    add(
      `${visible.length} participants, avec un locuteur et des badges`,
      await render.renderVoice({
        participants: withSpeaking(visible, 1),
        avatarSource: source,
        channelName,
      }),
    );
  }

  if (participants.length > render.MAX_VISIBLE) {
    for (const offset of [0, Math.floor(participants.length / 2)]) {
      add(
        `Carrousel, fenetre a l'offset ${offset} (sur ${participants.length})`,
        await render.renderVoice({
          participants: withSpeaking(participants, offset),
          avatarSource: source,
          mode: "paged",
          offset,
          channelName,
        }),
      );
    }
  }

  if (first !== undefined) {
    add(
      "Popup — arrivee",
      await render.renderPopup({ participant: first, kind: "joined", avatarSource: source }),
    );
  }

  if (last !== undefined) {
    add(
      "Popup — depart",
      await render.renderPopup({ participant: last, kind: "left", avatarSource: source }),
    );
  }

  return entries;
}

async function writeContactSheet(entries: ContactSheetEntry[], name: string): Promise<string> {
  const directory = ensureOutDir();
  const sheet = await render.renderContactSheet(entries);
  const file = path.join(directory, `${name}.png`);
  fs.writeFileSync(file, sheet);

  // On ecrit aussi les rendus a taille reelle : c'est ce que l'Infobar affichera.
  entries.forEach((entry, index) => {
    const slug = String(index + 1).padStart(2, "0");
    const safe = entry.label
      .normalize("NFD")
      .replaceAll(/[^a-zA-Z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "")
      .toLowerCase();
    fs.writeFileSync(path.join(directory, `${name}-${slug}-${safe}.png`), entry.png);
  });

  return file;
}

// --- Commandes ---------------------------------------------------------------

async function commandSmoke(): Promise<void> {
  const configured = (process.env["DISCORD_CLIENT_ID"] ?? "").trim() !== "";
  const clientId = configured ? loadConfig().clientId : FALLBACK_CLIENT_ID;

  if (!configured) {
    log.warn("DISCORD_CLIENT_ID absent : utilisation d'un identifiant public.");
    log.warn("Suffisant pour tester la connexion, pas pour l'autorisation.");
  }

  // Pas de loadConfig() ici : smoke doit fonctionner avant toute configuration.
  const ipc = new DiscordIpc({ clientId });
  await ipc.connect();
  log.ok(`Connexion etablie (pipe ${ipc.pipePath}).`);

  try {
    const me = ipc.selfUser;
    if (me === null) {
      log.warn("READY ne contient pas d'utilisateur exploitable.");
    } else {
      log.ok(`Session : ${me.global_name ?? me.username} (${me.id})`);

      // Verifie la brique qui compte pour l'Infobar : recuperer une image et
      // l'ecrire sur disque, exactement comme le fera le cache d'avatars.
      const image = await ipc.call<{ data_url?: string }>("GET_IMAGE", {
        type: "user",
        id: me.id,
        format: "png",
        size: 128,
      });

      const decoded = typeof image.data_url === "string" ? decodeDataUrl(image.data_url) : null;
      if (decoded === null) {
        log.warn("GET_IMAGE n'a pas renvoye d'image exploitable.");
      } else {
        const file = path.join(ensureOutDir(), "smoke-avatar.png");
        fs.writeFileSync(file, decoded);
        log.ok(`GET_IMAGE OK : PNG de ${decoded.length} octets ecrit dans ${path.relative(process.cwd(), file)}`);
      }
    }

    log.step("Commandes reservees a l'autorisation :");
    for (const command of ["GET_SELECTED_VOICE_CHANNEL", "GET_GUILDS", "GET_VOICE_SETTINGS"]) {
      try {
        await ipc.call(command);
        log.ok(`${command} : accessible sans autorisation (inattendu).`);
      } catch (error) {
        log.info(`${command} : ${(error as Error).message}`);
      }
    }
  } finally {
    ipc.close();
  }

  log.ok("smoke termine.");
}

async function commandAuth(): Promise<void> {
  const config = loadConfig();
  warnAboutPortalSetup();
  const ipc = await connect(config);

  try {
    // `ensureAuthenticated` gere tout : reutilisation du token stocke,
    // rafraichissement, ou consentement si necessaire.
    const tokens = await ensureAuthenticated(ipc, AUTH_FILE, authOptions(config));
    log.ok(`Autorise. Scopes : ${tokens.scope}`);
    log.info(`Token valable jusqu'au ${new Date(tokens.expires_at).toLocaleString()}`);
  } finally {
    ipc.close();
  }
}

async function commandStatus(): Promise<void> {
  const config = loadConfig();
  const ipc = await connect(config);

  try {
    await ensureAuthenticated(ipc, AUTH_FILE, authOptions(config));
    const monitor = new VoiceMonitor(ipc);
    await monitor.start();
    printParticipants(monitor);

    const guild = await monitor.guildName(monitor.channel);
    if (guild !== null) log.info(`Serveur : ${guild}`);
  } finally {
    ipc.close();
  }
}

async function commandWatch(): Promise<void> {
  const config = loadConfig();
  const ipc = await connect(config);

  await ensureAuthenticated(ipc, AUTH_FILE, authOptions(config));

  const store = new AvatarStore(ipc, AVATAR_DIR);
  const monitor = new VoiceMonitor(ipc);
  let guildName: string | null = null;

  const popup = async (participant: Participant, kind: "joined" | "left"): Promise<void> => {
    const png = await render.renderPopup({
      participant,
      kind,
      avatarSource: store,
      channelName: guildName,
    });
    const file = path.join(ensureOutDir(), `popup-${kind}-${participant.id}.png`);
    fs.writeFileSync(file, png);
    log.info(`Rendu ecrit : ${path.relative(process.cwd(), file)}`);
  };

  monitor.on("channel", async (channel) => {
    guildName = await monitor.guildName(channel);
    log.step(
      channel === null
        ? "Hors vocal."
        : `Salon vocal : ${channel.name}${guildName === null ? "" : ` (${guildName})`}`,
    );
  });

  monitor.on("update", (participants, channel) => {
    const where = channel === null ? "hors vocal" : channel.name;
    process.stderr.write(
      `\n${participants.length} participant(s) [${where}] : ` +
        `${participants.map((p) => `${p.name}${p.speaking ? "*" : ""}`).join(", ")}\n`,
    );
  });

  monitor.on("joined", (participant) => {
    log.ok(`${participant.name} a rejoint.`);
    void popup(participant, "joined");
  });

  monitor.on("left", (participant) => {
    log.warn(`${participant.name} a quitte.`);
    void popup(participant, "left");
  });

  monitor.on("speaking", (participant) => log.info(`${participant.name} parle.`));
  monitor.on("stoppedSpeaking", (participant) => log.info(`${participant.name} se tait.`));

  await monitor.start();
  log.step("Suivi en direct. Ctrl+C pour arreter.");

  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      log.step("Arret.");
      resolve();
    });
  });

  ipc.close();
}

async function commandPreview(args: Map<string, string>, flags: Set<string>): Promise<void> {
  // `--fake` force des donnees synthetiques ; `--live` force les donnees
  // reelles. Sans option, on choisit selon la presence d'un token.
  const useFake = flags.has("fake") || (!flags.has("live") && !fs.existsSync(AUTH_FILE));
  const explicitFake = flags.has("fake");
  let entries: ContactSheetEntry[];
  let name: string;

  if (useFake) {
    if (!explicitFake) {
      log.warn("Aucun token trouve : rendu avec des donnees factices.");
      log.warn("Lance `npm run auth` puis `npm run preview -- --live` pour tes vrais avatars.");
    }

    const count = Number.parseInt(args.get("count") ?? "7", 10);
    const participants = fakeParticipants(Number.isFinite(count) ? count : 7, 1);
    entries = await buildContactSheet(new FakeAvatarStore(), participants, "Salon general");
    name = "preview-fake";
  } else {
    const config = loadConfig();
    const ipc = await connect(config);

    try {
      await ensureAuthenticated(ipc, AUTH_FILE, authOptions(config));
      const monitor = new VoiceMonitor(ipc);
      await monitor.start();

      const store = new AvatarStore(ipc, AVATAR_DIR);
      log.info("Lecture du salon vocal...");
      const guildName = await monitor.guildName(monitor.channel);
      const participants = monitor.participants;

      if (participants.length === 0) {
        log.warn("Personne dans le salon : la planche n'affichera que l'etat vide.");
        log.warn("Utilise `npm run preview -- --fake --count=7` pour voir tous les cas.");
      } else {
        log.ok(`${participants.length} participant(s) recuperes, avatars en cours de chargement...`);
      }

      entries = await buildContactSheet(store, participants, guildName);
      name = "preview-live";

      for (const participant of participants) {
        log.info(`  avatar ${participant.name} : ${participant.avatarHash ?? "par defaut"}`);
      }
    } finally {
      ipc.close();
    }
  }

  const file = await writeContactSheet(entries, name);
  log.ok(`Planche de rendu : ${path.relative(process.cwd(), file)}`);

  if (flags.has("open")) openFile(file);
}

function printHelp(): void {
  process.stdout.write(
    [
      "Prototype discord-voice-presence",
      "",
      "  smoke      verifie la connexion au RPC local (aucune autorisation requise)",
      "  auth       demande l'autorisation OAuth et stocke le token",
      "  status     affiche le salon vocal courant et ses participants",
      "  watch      suivi en direct des arrivees, departs et prises de parole",
      "  preview    genere une planche de rendu de l'Infobar (232 x 50)",
      "",
      "Options de `preview` :",
      "  --fake         force des donnees synthetiques",
      "  --live         force les donnees reelles du salon vocal",
      "  --count=N      nombre de participants factices (7 par defaut)",
      "  --open         ouvre la planche dans la visionneuse par defaut",
      "",
      "`status`, `watch` et `preview` (sans --fake) necessitent un `.env` rempli",
      "et une autorisation prealable via `auth`.",
      "",
    ].join("\n"),
  );
}

// --- Entree ------------------------------------------------------------------

function parseArgs(argv: readonly string[]): {
  command: string;
  args: Map<string, string>;
  flags: Set<string>;
} {
  const [command = "help", ...rest] = argv;
  const args = new Map<string, string>();
  const flags = new Set<string>();

  for (const token of rest) {
    if (!token.startsWith("--")) continue;

    const body = token.slice(2);
    const separator = body.indexOf("=");
    if (separator === -1) {
      flags.add(body);
    } else {
      args.set(body.slice(0, separator), body.slice(separator + 1));
      flags.add(body.slice(0, separator));
    }
  }

  return { command, args, flags };
}

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "smoke":
      await commandSmoke();
      return;
    case "auth":
      await commandAuth();
      return;
    case "status":
      await commandStatus();
      return;
    case "watch":
      await commandWatch();
      return;
    case "preview":
      await commandPreview(args, flags);
      return;
    default:
      printHelp();
      return;
  }
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
