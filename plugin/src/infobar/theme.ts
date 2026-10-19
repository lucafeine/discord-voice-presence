/**
 * Infobar geometry and asset factory.
 *
 * SINGLE SOURCE of geometry, shared by two consumers:
 *   - tools/generate-infobar.ts, which writes the fixed assets and the layout;
 *   - the plugin, which rewrites the card and frames when the user changes the
 *     background color.
 *
 * If the two diverged, avatars would be clipped incorrectly: hence this single
 * module, with no dependencies, importable by rollup and directly by Node.
 */

// --- Geometrie ---------------------------------------------------------------

export const WIDTH = 232;
export const HEIGHT = 50;

/**
 * Number of avatars displayable at once, and scroll window width.
 */
export const VISIBLE_SLOTS = 4;

/**
 * Available positions in the layout.
 *
 * An item position is FIXED in the layout: only its value and opacity change at
 * runtime. With a grid spaced by one full slot, centering 1, 2, or 3 avatars
 * would always be off. The grid therefore advances by HALF a slot, which lets
 * every centered configuration land correctly: 3 positions for 1 avatar, 2 for
 * 2, 1 for 3, 0 for 4.
 */
export const GRID_SLOTS = 7;

/**
 * Avatar diameter.
 *
 * This is the maximum usable size: the canvas is 50 px high and the ring must
 * fit on both sides. 44 + 2 x 3 = 50, the full height.
 */
export const AVATAR = 44;
/** Frame diameter, and therefore the ring's outer edge. */
export const CIRCLE = 50;
/** Ring thickness. */
export const RING_WIDTH = 3;
/** Gap between two slots. */
export const PITCH = 56;
export const BADGE = 18;

export const ROW_WIDTH = CIRCLE + (VISIBLE_SLOTS - 1) * PITCH;
export const START_X = Math.round((WIDTH - ROW_WIDTH) / 2);
export const FRAME_Y = Math.round((HEIGHT - CIRCLE) / 2);
export const INSET = (CIRCLE - AVATAR) / 2;
export const AVATAR_Y = FRAME_Y + INSET;
export const AVATAR_RADIUS = AVATAR / 2;
export const CIRCLE_RADIUS = CIRCLE / 2;

/** Gap between two grid positions: half a slot. */
export const GRID_STEP = PITCH / 2;

/** Top-left corner of grid position `index`. */
export const slotX = (index: number): number => START_X + index * GRID_STEP;
/** Top-left corner of the avatar at position `index`. */
export const avatarX = (index: number): number => slotX(index) + INSET;

/**
 * Starting position of a centered row of `count` avatars.
 *
 * Occupied positions are then `start + 2i`. The row ends up centered within
 * half a slot, which is invisible over 232 px.
 */
export function centeredStart(count: number): number {
	return Math.max(0, VISIBLE_SLOTS - count);
}

// --- Couleurs ----------------------------------------------------------------

export const DEFAULT_BACKGROUND = "#000000";
export const CARD_BORDER = "#2b2d31";
export const SPEAKING_COLOR = "#23a55a";

/**
 * Colors for join, leave, and channel-change announcements.
 *
 * Cuts are no longer part of it: they have their own veil.
 */
export const ALERT_ACCENTS: Record<string, string> = {
	joined: "#23a55a",
	left: "#ed4245",
	channel: "#1e1f22"
};

/**
 * Cut colors: red in both cases.
 *
 * What distinguishes microphone from headset is the pictogram and the text.
 */
export const CUT_COLORS: Record<string, string> = {
	mute: "#ed4245",
	deafen: "#ed4245"
};

// --- Surcouche d'alerte ------------------------------------------------------

export const ALERT_FRAME_X = 8;
export const ALERT_FRAME_Y = FRAME_Y;
export const ALERT_AVATAR_X = ALERT_FRAME_X + INSET;
export const ALERT_AVATAR_Y = FRAME_Y + INSET;
export const ALERT_TEXT_X = ALERT_FRAME_X + CIRCLE + 12;
export const ALERT_TEXT_WIDTH = WIDTH - ALERT_TEXT_X - 8;

/**
 * Channel name, announced alone and large.
 *
 * Dedicated item rather than the status text: the latter occupies the top half
 * of the canvas, which would leave the name visibly shifted upward when alone
 * on screen.
 */
export const CHANNEL_TEXT_X = 6;
export const CHANNEL_TEXT_Y = 8;
export const CHANNEL_TEXT_WIDTH = WIDTH - 12;
export const CHANNEL_TEXT_HEIGHT = 34;
export const CHANNEL_FONT_SIZE = 22;
export const CHANNEL_FONT_WEIGHT = 700;

// --- Reminder veil -----------------------------------------------------------

export const FLASH_BAR_X = 6;
export const FLASH_BAR_Y = 9;
export const FLASH_BAR_WIDTH = 3;
export const FLASH_BAR_HEIGHT = 32;
export const FLASH_ICON = 26;
export const FLASH_ICON_X = 15;
export const FLASH_ICON_Y = Math.round((HEIGHT - FLASH_ICON) / 2);
export const FLASH_TEXT_X = 48;
export const FLASH_TEXT_WIDTH = WIDTH - FLASH_TEXT_X - 8;

/**
 * Stacking orders, from back to front.
 *
 * Each grid position has its OWN order range, and that is not a detail: positions
 * are spaced by half a slot while frames span a full slot, so two neighboring
 * positions always overlap. At the same order, an overlap makes the ENTIRE
 * layout fail to render: nothing appears.
 *
 * Two neighboring positions are never visible at the same time, since occupied
 * positions advance by two steps. The paint order between them therefore has no
 * visual impact.
 */
export const Z = {
	card: 0,
	/** Premiere position de la rangee ; chaque position occupe 3 ordres. */
	rowBase: 10,
	rowStep: 3,
	flashBg: 40,
	flashBar: 41,
	flashIcon: 42,
	flashText: 43,
	alertBg: 50,
	alertAccent: 51,
	alertAvatar: 52,
	alertFrame: 53,
	alertText: 54,
	status: 60,
	/** Nom du salon annonce seul : au-dessus de tout le reste. */
	channelText: 61
} as const;

/** Ordre de l'avatar de la position `index`. */
export const avatarZ = (index: number): number => Z.rowBase + index * Z.rowStep;
/** Ordre du cadre de la position `index`. */
export const frameZ = (index: number): number => avatarZ(index) + 1;
/** Ordre du badge de la position `index`. */
export const badgeZ = (index: number): number => avatarZ(index) + 2;

// --- Fabrique d'assets -------------------------------------------------------

/** Sub-path of a disc, usable in a path filled with `evenodd`. */
export function disc(cx: number, cy: number, radius: number): string {
	return `M ${cx - radius} ${cy} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0 Z`;
}

function svg(width: number, height: number, body: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n${body}\n</svg>\n`;
}

export function cardSvg(color: string): string {
	return svg(
		WIDTH,
		HEIGHT,
		`  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="10" fill="${color}" stroke="${CARD_BORDER}"/>`
	);
}

/**
 * Frame placed over the avatar.
 *
 * Two constraints intersect.
 *
 * 1. The hole must be EXACTLY the avatar diameter, i.e. its inscribed circle. A
 *    larger hole does not clip the corners and the avatar shows as a square
 *    with rounded corners.
 *
 * 2. The cover must NOT exceed the avatar's footprint. The frame occupies the
 *    full canvas height: a square cover of its full size would overflow the
 *    card and erase its rounded corners. It is therefore limited to the
 *    avatar's footprint, which reduces it to its four corners.
 *
 * Consequence: the ring overlaps the crown of those corners, so it is drawn
 * AFTER the cover. In the other order, it would be covered.
 */
export function frameSvg(coverColor: string, speaking = false): string {
	const centre = CIRCLE_RADIUS;
	const inset = (CIRCLE - AVATAR) / 2;
	const inner = CIRCLE - inset;

	const parts = [
		`  <path d="M ${inset} ${inset} H ${inner} V ${inner} H ${inset} Z ${disc(centre, centre, AVATAR_RADIUS)}" fill="${coverColor}" fill-rule="evenodd"/>`
	];

	if (speaking) {
		const ringRadius = (AVATAR_RADIUS + CIRCLE_RADIUS) / 2;
		parts.push(
			`  <circle cx="${centre}" cy="${centre}" r="${ringRadius}" fill="none" stroke="${SPEAKING_COLOR}" stroke-width="${RING_WIDTH}"/>`
		);
	}

	return svg(CIRCLE, CIRCLE, parts.join("\n"));
}

/**
 * Cut pictogram, shared by the badge and the reminder veil.
 *
 * One drawing for both uses: the badge surrounds it with a colored disc, the
 * veil places it alone, in white, next to the text.
 *
 * Both cuts are struck through with the same slash — a microphone for mute, a
 * headset for deafen — so the pictogram alone tells which cut it is.
 */
export function cutGlyph(kind: string): string {
	if (kind === "mute") {
		return `<g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round">
           <rect x="9.4" y="4.2" width="5.2" height="9.2" rx="2.6"/>
           <path d="M6.9 11.2a5.1 5.1 0 0 0 10.2 0"/>
           <line x1="12" y1="16.4" x2="12" y2="19"/>
         </g>
         <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="#ed4245" stroke-width="4.8" stroke-linecap="round"/>
         <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`;
	}

	return `<g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round">
           <path d="M5.2 14.2v-2.6a6.8 6.8 0 0 1 13.6 0v2.6"/>
         </g>
         <rect x="4" y="12.4" width="3.7" height="6.4" rx="1.7" fill="#fff"/>
         <rect x="16.3" y="12.4" width="3.7" height="6.4" rx="1.7" fill="#fff"/>
         <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="#ed4245" stroke-width="4.8" stroke-linecap="round"/>
         <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`;
}

/** Cut color, with an explicit failure when the key does not exist. */
export function cutColor(kind: string): string {
	const color = CUT_COLORS[kind];
	if (color === undefined) {
		throw new Error(`Unknown cut color: ${kind}`);
	}
	return color;
}

/**
 * Status badge, at the bottom right of the avatar.
 *
 * Red for both cuts: the pictogram indicates whether it is the microphone or
 * the headset. The headset wins because it also mutes the microphone.
 */
export function badgeSvg(kind: string): string {
	const fill = cutColor(kind);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="11.5" fill="${fill}" stroke="${DEFAULT_BACKGROUND}" stroke-width="1.5"/>
  ${cutGlyph(kind)}
</svg>
`;
}

export function accentSvg(color: string): string {
	return svg(
		WIDTH,
		HEIGHT,
		`  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="10" fill="${color}"/>`
	);
}

/** Opaque announcement card: it must hide the avatar row. */
export function alertBackgroundSvg(): string {
	return svg(
		WIDTH,
		HEIGHT,
		`  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="10" fill="${DEFAULT_BACKGROUND}" stroke="${CARD_BORDER}"/>`
	);
}

/** Opaque background of the reminder veil. */
export function flashBackgroundSvg(color: string): string {
	return svg(
		WIDTH,
		HEIGHT,
		`  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="10" fill="${color}"/>`
	);
}

export function flashBarSvg(): string {
	return svg(
		FLASH_BAR_WIDTH,
		FLASH_BAR_HEIGHT,
		`  <rect x="0" y="0" width="${FLASH_BAR_WIDTH}" height="${FLASH_BAR_HEIGHT}" rx="${FLASH_BAR_WIDTH / 2}" fill="#FFFFFF"/>`
	);
}

export function flashIconSvg(kind: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  ${cutGlyph(kind)}
</svg>
`;
}

/** Fallback avatar when the image cannot be found. */
export function placeholderSvg(): string {
	const grey = "#6b6f76";
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR}" height="${AVATAR}">
  <circle cx="${AVATAR_RADIUS}" cy="${AVATAR_RADIUS}" r="${AVATAR_RADIUS}" fill="${CARD_BORDER}"/>
  <circle cx="${AVATAR_RADIUS}" cy="${AVATAR_RADIUS - 4}" r="5.4" fill="${grey}"/>
  <path d="M${AVATAR_RADIUS} ${AVATAR_RADIUS + 3}c6.2 0 11.2 4.6 11.2 10.2H${AVATAR_RADIUS - 11.2}c0-5.6 5-10.2 11.2-10.2z" fill="${grey}"/>
</svg>
`;
}

// --- Theme depending on the chosen color -------------------------------------

/** Normalizes a color to `#rrggbb`, or returns the default value. */
export function normalizeColor(input: unknown): string {
	if (typeof input !== "string") return DEFAULT_BACKGROUND;

	const value = input.trim();
	if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
	if (/^#[0-9a-fA-F]{3}$/.test(value)) {
		const [r, g, b] = [value[1], value[2], value[3]];
		return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
	}

	return DEFAULT_BACKGROUND;
}

/** Folder key for a color: it is what invalidates the rendering. */
export function themeKey(color: string): string {
	return normalizeColor(color).slice(1);
}

/**
 * Assets to rewrite when the background color changes.
 *
 * The file name contains the color. This is intentional: Stream Deck re-reads a
 * pixmap only when its path changes, so rewriting the same file would leave the
 * old color on screen.
 */
export function themeAssets(color: string): Array<{ path: string; svg: string }> {
	const background = normalizeColor(color);
	const key = themeKey(background);

	return [
		{ path: `imgs/infobar/theme/card-${key}.svg`, svg: cardSvg(background) },
		{ path: `imgs/infobar/theme/frame-${key}.svg`, svg: frameSvg(background, false) },
		{ path: `imgs/infobar/theme/frame-speaking-${key}.svg`, svg: frameSvg(background, true) }
	];
}

/** Theme asset paths, once written. */
export function themePaths(color: string): { card: string; frame: string; frameSpeaking: string } {
	const key = themeKey(color);
	return {
		card: `imgs/infobar/theme/card-${key}.svg`,
		frame: `imgs/infobar/theme/frame-${key}.svg`,
		frameSpeaking: `imgs/infobar/theme/frame-speaking-${key}.svg`
	};
}
