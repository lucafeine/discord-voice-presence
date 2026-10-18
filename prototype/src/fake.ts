/**
 * Participants et avatars synthetiques.
 *
 * Permet de valider le rendu de l'Infobar sans Discord, sans autorisation et
 * sans reseau : `npm run preview -- --fake`.
 *
 * `FakeAvatarStore` respecte le meme contrat que `AvatarStore` afin que le
 * renderer soit totalement agnostique de la source des images.
 */

import sharp from "sharp";
import type { Participant } from "./types.ts";

const NAMES = [
  "Lucas",
  "Camille",
  "Theo",
  "Ines",
  "Rayan",
  "Margot",
  "Nils",
  "Sofia",
  "Hugo",
  "Jade",
] as const;

/** Palettes pour les avatars factices, dans l'esprit des couleurs Discord. */
const PALETTE = [
  ["#5865f2", "#8b95ff"],
  ["#eb459e", "#ff8ec4"],
  ["#57f287", "#9bf7b8"],
  ["#fee75c", "#fff3a8"],
  ["#ed4245", "#ff8a8c"],
  ["#00b0f4", "#7fd8ff"],
  ["#9b59b6", "#c79bdb"],
  ["#e67e22", "#f5b183"],
] as const;

export const FAKE_PREFIX = "fake:";

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.codePointAt(0)!) % 1_000_000_007;
  return value;
}

export function fakeParticipants(count: number, speakingIndex?: number): Participant[] {
  return Array.from({ length: count }, (_, index) => {
    const name = NAMES[index % NAMES.length] ?? `Utilisateur ${index + 1}`;
    return {
      id: String(100_000_000_000_000_000n + BigInt(index)),
      name,
      username: `user_${index + 1}`,
      avatarHash: `${FAKE_PREFIX}${name}`,
      avatarDecorationAsset: null,
      isBot: false,
      // On introduit de la variete pour voir les badges a l'ecran.
      selfMute: index % 4 === 1,
      selfDeaf: index % 5 === 3,
      serverMute: index % 7 === 5,
      serverDeaf: false,
      suppressed: false,
      speaking: speakingIndex === index,
    } satisfies Participant;
  });
}

/** Dessine un avatar factice : disque degrade + initiale. */
export async function fakeAvatar(name: string, size = 128): Promise<Buffer> {
  const [start, end] = PALETTE[hash(name) % PALETTE.length] ?? ["#5865f2", "#8b95ff"];
  const initial = [...name][0]?.toUpperCase() ?? "?";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${start}"/>
      <stop offset="1" stop-color="${end}"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="50" fill="url(#g)"/>
  <text x="50" y="50" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="46"
        font-weight="600" text-anchor="middle" dominant-baseline="central">${initial}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Magasin d'avatars factices, avec le meme contrat que `AvatarStore`. */
export class FakeAvatarStore {
  readonly #memory = new Map<string, Buffer>();

  async get(userId: string, avatarHash: string | null, size = 128): Promise<Buffer | null> {
    const seed = (avatarHash ?? userId).replace(FAKE_PREFIX, "");
    const key = `${seed}-${size}`;

    const cached = this.#memory.get(key);
    if (cached !== undefined) return cached;

    const buffer = await fakeAvatar(seed, size);
    this.#memory.set(key, buffer);
    return buffer;
  }
}
