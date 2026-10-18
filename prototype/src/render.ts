/**
 * Rendu de l'Infobar du Stream Deck Neo.
 *
 * Le layout d'un Infobar fait 232 x 50 px. Plutot que d'empiler des dizaines
 * d'items `pixmap` positionnes a la main dans un fichier de layout, on compose
 * une image unique de 232 x 50 et on l'expose via un seul item `pixmap` qui
 * couvre tout le layout. Consequences :
 *   - controle total du dessin (anneaux, badges, texte, arrondis) ;
 *   - le fichier de layout reste trivial ;
 *   - le rendu final est verifiable hors Stream Deck, a l'identique.
 *
 * Contrainte a garder en tete : un layout est un rendu *discret*. Pas
 * d'animation possible, seulement des images successives.
 */

import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import type { Participant } from "./types.ts";

export const CANVAS_WIDTH = 232;
export const CANVAS_HEIGHT = 50;

/** Diametre de l'avatar. */
const AVATAR = 34;
/** Diametre de l'anneau, qui depasse autour de l'avatar. */
const RING = 40;
/** Ecart entre deux emplacements, choisi pour laisser respirer les anneaux. */
const PITCH = 44;
/** Nombre d'emplacements visibles simultanement. */
export const MAX_VISIBLE = 5;

const BADGE = 14;

const COLOR = {
  card: "#1e1f22",
  cardBorder: "#2b2d31",
  text: "#f2f3f5",
  textMuted: "#949ba4",
  speaking: "#23a55a",
  joined: "#23a55a",
  left: "#ed4245",
  mute: "#ed4245",
  deaf: "#f0b232",
} as const;

/** Toute source d'avatars : le RPC Discord, ou des images factices. */
export interface AvatarSource {
  get(userId: string, avatarHash: string | null, size?: number): Promise<Buffer | null>;
}

export type VoiceMode = "static" | "paged";

export interface VoiceRenderOptions {
  participants: readonly Participant[];
  avatarSource: AvatarSource;
  /** `paged` fait defiler une fenetre de 5 emplacements. */
  mode?: VoiceMode;
  /** Decalage de la fenetre, en mode `paged`. */
  offset?: number;
  /** Affiche le nom du salon en petit, a droite, quand il y a peu de monde. */
  channelName?: string | null;
}

export interface PopupRenderOptions {
  participant: Participant;
  kind: "joined" | "left";
  avatarSource: AvatarSource;
  channelName?: string | null;
}

// --- Primitives --------------------------------------------------------------

function backgroundSvg(width: number, height: number, radius = 10): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${radius}"
        fill="${COLOR.card}" stroke="${COLOR.cardBorder}"/>
</svg>`);
}

/** Avatar decoupe en cercle. */
async function circularAvatar(png: Buffer, size: number): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>
    </svg>`,
  );

  return sharp(png)
    .resize(size, size, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** Anneau plein, dessine sous l'avatar pour marquer celui qui parle. */
async function ringPng(size: number, color: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${(size - 1.5) / 2}" fill="none"
            stroke="${color}" stroke-width="3"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Badge d'etat, en bas a droite de l'avatar.
 *
 * Priorite au casque : sur Discord, se mettre en sourdine coupe aussi le micro,
 * donc "deaf" est l'information la plus utile.
 *
 * Le trait diagonal est precede d'un trait epais de la couleur du badge : cela
 * "decoupe" le pictogramme et rend la barre lisible meme a 14 px.
 */
async function badgePng(kind: "mute" | "deaf", size = BADGE): Promise<Buffer> {
  const fill = kind === "mute" ? COLOR.mute : COLOR.deaf;

  const glyph =
    kind === "mute"
      ? `<g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round">
           <rect x="9.4" y="4.2" width="5.2" height="9.2" rx="2.6"/>
           <path d="M6.9 11.2a5.1 5.1 0 0 0 10.2 0"/>
           <line x1="12" y1="16.4" x2="12" y2="19"/>
         </g>`
      : `<g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round">
           <path d="M5.2 14.2v-2.6a6.8 6.8 0 0 1 13.6 0v2.6"/>
         </g>
         <rect x="4" y="12.4" width="3.7" height="6.4" rx="1.7" fill="#fff"/>
         <rect x="16.3" y="12.4" width="3.7" height="6.4" rx="1.7" fill="#fff"/>`;

  const slash =
    kind === "mute"
      ? `<line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="${fill}" stroke-width="4.8" stroke-linecap="round"/>
         <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`
      : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="11.5" fill="${fill}" stroke="${COLOR.card}" stroke-width="1.5"/>
    ${glyph}
    ${slash}
  </svg>`;

  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Tronque un texte a une largeur donnee.
 *
 * SVG ne sait pas faire d'ellipse : on estime la largeur avec un facteur
 * moyen par caractere. Approximation, mais suffisante pour un ecran de
 * 232 px ou le pire cas est un nom trop long.
 */
function fitText(text: string, maxWidth: number, fontSize: number): string {
  const perChar = fontSize * 0.56;
  const maxChars = Math.max(1, Math.floor(maxWidth / perChar));
  if ([...text].length <= maxChars) return text;
  return `${[...text].slice(0, Math.max(1, maxChars - 1)).join("")}…`;
}

interface TextItem {
  text: string;
  x: number;
  y: number;
  size: number;
  weight?: number;
  color?: string;
  anchor?: "start" | "middle";
}

function textSvg(width: number, height: number, items: readonly TextItem[]): Buffer {
  const body = items
    .map(
      (item) =>
        `<text x="${item.x}" y="${item.y}" font-family="Segoe UI, Inter, Noto Sans, Arial, sans-serif"` +
        ` font-size="${item.size}" font-weight="${item.weight ?? 400}" fill="${item.color ?? COLOR.text}"` +
        ` text-anchor="${item.anchor ?? "start"}" dominant-baseline="central">${escapeXml(item.text)}</text>`,
    )
    .join("\n");

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
}

/** Positions des emplacements, centres horizontalement. */
function slotPositions(count: number): number[] {
  if (count === 0) return [];
  const total = RING + (count - 1) * PITCH;
  const start = Math.round((CANVAS_WIDTH - total) / 2);
  return Array.from({ length: count }, (_, index) => start + index * PITCH);
}

function isMuted(participant: Participant): boolean {
  return participant.selfMute || participant.serverMute || participant.suppressed;
}

function isDeafened(participant: Participant): boolean {
  return participant.selfDeaf || participant.serverDeaf;
}

/** Etiquette d'etat, ou `null` si le participant est audible et non coupe. */
function stateLabel(participant: Participant): string | null {
  if (isDeafened(participant)) return "casque coupe";
  if (participant.suppressed) return "sourdine serveur";
  if (isMuted(participant)) return "micro coupe";
  return null;
}

/** Rend un participant : anneau eventuel, avatar, badge eventuel. */
async function drawParticipant(
  participant: Participant,
  ringX: number,
  avatarSource: AvatarSource,
  overlays: OverlayOptions[],
): Promise<void> {
  const ringY = Math.round((CANVAS_HEIGHT - RING) / 2);
  const inset = (RING - AVATAR) / 2;
  const avatarX = ringX + inset;
  const avatarY = ringY + inset;

  if (participant.speaking) {
    overlays.push({ input: await ringPng(RING, COLOR.speaking), left: ringX, top: ringY });
  }

  const raw = await avatarSource.get(participant.id, participant.avatarHash, 128);
  if (raw === null) {
    // Pas d'image : on laisse un disque neutre plutot qu'un trou.
    overlays.push({
      input: await sharp({
        create: { width: AVATAR, height: AVATAR, channels: 4, background: COLOR.cardBorder },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR}" height="${AVATAR}">
                 <circle cx="${AVATAR / 2}" cy="${AVATAR / 2}" r="${AVATAR / 2}" fill="${COLOR.cardBorder}"/>
               </svg>`,
            ),
            blend: "over",
          },
        ])
        .png()
        .toBuffer(),
      left: Math.round(avatarX),
      top: Math.round(avatarY),
    });
  } else {
    overlays.push({
      input: await circularAvatar(raw, AVATAR),
      left: Math.round(avatarX),
      top: Math.round(avatarY),
    });
  }

  if (isDeafened(participant)) {
    overlays.push({
      input: await badgePng("deaf"),
      left: Math.round(avatarX + AVATAR - BADGE + 1),
      top: Math.round(avatarY + AVATAR - BADGE + 1),
    });
  } else if (isMuted(participant)) {
    overlays.push({
      input: await badgePng("mute"),
      left: Math.round(avatarX + AVATAR - BADGE + 1),
      top: Math.round(avatarY + AVATAR - BADGE + 1),
    });
  }
}

// --- Rendu principal ---------------------------------------------------------

/** Fenetre glissante circulaire, pour le mode `paged`. */
export function windowParticipants(
  participants: readonly Participant[],
  offset: number,
  size = MAX_VISIBLE,
): Participant[] {
  if (participants.length <= size) return [...participants];
  return Array.from({ length: size }, (_, index) => {
    const position = (offset + index) % participants.length;
    return participants[position]!;
  });
}

/**
 * Rangee d'avatars.
 *
 * Avec 1 ou 2 personnes, elle est alignee a gauche et l'espace restant sert a
 * afficher les noms : c'est plus utile qu'une rangee perdue au centre.
 */
export async function renderVoice(options: VoiceRenderOptions): Promise<Buffer> {
  const mode = options.mode ?? "static";
  const visible =
    mode === "paged"
      ? windowParticipants(options.participants, options.offset ?? 0)
      : options.participants.slice(0, MAX_VISIBLE);

  const withNames = options.participants.length <= 2 && visible.length === options.participants.length;
  const overlays: OverlayOptions[] = [];

  const positions = withNames
    ? visible.map((_, index) => 8 + index * PITCH)
    : slotPositions(visible.length);

  for (const [index, participant] of visible.entries()) {
    const x = positions[index];
    if (x === undefined) continue;
    await drawParticipant(participant, x, options.avatarSource, overlays);
  }

  const texts: TextItem[] = [];

  if (withNames) {
    const textX = 8 + visible.length * PITCH + 2;
    const available = CANVAS_WIDTH - textX - 10;

    if (visible.length === 1) {
      // Une seule personne : nom en grand, puis l'information la plus utile
      // (son etat s'il est coupe, sinon le nom du salon).
      const participant = visible[0]!;
      const detail = stateLabel(participant) ?? options.channelName ?? null;

      texts.push({
        text: fitText(participant.name, available, 16),
        x: textX,
        y: detail === null ? CANVAS_HEIGHT / 2 : 17,
        size: 16,
        weight: 600,
        color: participant.speaking ? COLOR.speaking : COLOR.text,
      });

      if (detail !== null) {
        texts.push({
          text: fitText(detail, available, 12),
          x: textX,
          y: 35,
          size: 12,
          color: COLOR.textMuted,
        });
      }
    } else {
      // Deux personnes : uniquement les noms, pour rester lisible dans 50 px.
      visible.forEach((participant, index) => {
        texts.push({
          text: fitText(participant.name, available, 15),
          x: textX,
          y: 17 + index * 17,
          size: 15,
          weight: 600,
          color: participant.speaking ? COLOR.speaking : COLOR.text,
        });
      });
    }
  }

  overlays.push({ input: textSvg(CANVAS_WIDTH, CANVAS_HEIGHT, texts), left: 0, top: 0 });

  return sharp(backgroundSvg(CANVAS_WIDTH, CANVAS_HEIGHT))
    .composite(overlays)
    .png()
    .toBuffer();
}

/** Aucun participant : on le dit clairement. */
export async function renderIdle(): Promise<Buffer> {
  const icon = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">
       <g stroke="${COLOR.textMuted}" stroke-width="2" fill="none" stroke-linecap="round">
         <rect x="9.3" y="4" width="5.4" height="9.6" rx="2.7"/>
         <path d="M6.6 11.4a5.4 5.4 0 0 0 10.8 0"/>
         <line x1="12" y1="16.8" x2="12" y2="19.6"/>
       </g>
       <line x1="4.4" y1="4.4" x2="19.6" y2="19.6" stroke="${COLOR.textMuted}"
             stroke-width="2.3" stroke-linecap="round"/>
     </svg>`,
  );

  const texts = textSvg(CANVAS_WIDTH, CANVAS_HEIGHT, [
    { text: "Pas en vocal", x: 130, y: CANVAS_HEIGHT / 2, size: 16, weight: 600, color: COLOR.textMuted },
  ]);

  return sharp(backgroundSvg(CANVAS_WIDTH, CANVAS_HEIGHT))
    .composite([
      { input: await sharp(icon).png().toBuffer(), left: 56, top: 14 },
      { input: texts, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

/**
 * Popup transitoire : quelqu'un vient d'arriver ou de partir.
 *
 * Affiche quelques secondes par-dessus la rangee, puis on revient au rendu
 * normal.
 */
export async function renderPopup(options: PopupRenderOptions): Promise<Buffer> {
  const accent = options.kind === "joined" ? COLOR.joined : COLOR.left;

  const accentBar = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="5" height="${CANVAS_HEIGHT - 12}">
       <rect x="0" y="0" width="5" height="${CANVAS_HEIGHT - 12}" rx="2.5" fill="${accent}"/>
     </svg>`,
  );

  const overlays: OverlayOptions[] = [];
  const avatarBytes = await options.avatarSource.get(
    options.participant.id,
    options.participant.avatarHash,
    128,
  );

  if (avatarBytes !== null) {
    overlays.push({
      input: await circularAvatar(avatarBytes, 38),
      left: 14,
      top: 6,
    });
  }

  const textX = avatarBytes === null ? 16 : 62;
  const available = CANVAS_WIDTH - textX - 12;

  const texts = textSvg(CANVAS_WIDTH, CANVAS_HEIGHT, [
    {
      text: fitText(options.participant.name, available, 17),
      x: textX,
      y: 18,
      size: 17,
      weight: 600,
      color: COLOR.text,
    },
    {
      text: fitText(
        options.kind === "joined" ? "a rejoint le vocal" : "a quitte le vocal",
        available,
        13,
      ),
      x: textX,
      y: 35,
      size: 13,
      color: accent,
    },
  ]);

  return sharp(backgroundSvg(CANVAS_WIDTH, CANVAS_HEIGHT))
    .composite([{ input: accentBar, left: 5, top: 6 }, ...overlays, { input: texts, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

// --- Planche de controle -----------------------------------------------------

export interface ContactSheetEntry {
  label: string;
  png: Buffer;
}

/**
 * Assemble plusieurs rendus dans une image zoomee, pour juger le design
 * a taille reelle et agrandie en une seule fois.
 */
export async function renderContactSheet(
  entries: readonly ContactSheetEntry[],
  zoom = 3,
): Promise<Buffer> {
  const gutter = 12;
  const labelHeight = 20;
  const rowHeight = CANVAS_HEIGHT * zoom + labelHeight;
  const width = CANVAS_WIDTH * zoom + gutter * 2;
  const height = rowHeight * entries.length + gutter * 2;

  const parts: OverlayOptions[] = [];
  for (const [index, entry] of entries.entries()) {
    const top = gutter + index * rowHeight;

    parts.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${labelHeight}">
           <text x="${gutter}" y="${labelHeight / 2}" font-family="Segoe UI, Inter, Arial, sans-serif"
                 font-size="13" font-weight="600" fill="#949ba4" dominant-baseline="central">
             ${escapeXml(entry.label)}
           </text>
         </svg>`,
      ),
      left: 0,
      top,
    });

    parts.push({
      input: await sharp(entry.png)
        .resize(CANVAS_WIDTH * zoom, CANVAS_HEIGHT * zoom, { kernel: "nearest" })
        .png()
        .toBuffer(),
      left: gutter,
      top: top + labelHeight,
    });
  }

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 12, g: 12, b: 14, alpha: 1 },
    },
  })
    .composite(parts)
    .png()
    .toBuffer();
}
