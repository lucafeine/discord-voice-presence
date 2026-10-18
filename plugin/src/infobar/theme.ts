/**
 * Geometrie et fabrique d'assets de l'Infobar.
 *
 * SOURCE UNIQUE de la geometrie, partagee par deux consommateurs :
 *   - tools/generate-infobar.ts, qui ecrit les assets fixes et le layout ;
 *   - le plugin, qui reecrit la carte et les cadres quand l'utilisateur change
 *     la couleur de fond.
 *
 * Si les deux divergeaient, les avatars seraient decoupes de travers : d'ou ce
 * module unique, sans aucune dependance, importable aussi bien par rollup que
 * directement par Node.
 */

// --- Geometrie ---------------------------------------------------------------

export const WIDTH = 232;
export const HEIGHT = 50;

/**
 * Nombre d'avatars affichables en meme temps, et largeur de la fenetre de
 * defilement.
 */
export const VISIBLE_SLOTS = 4;

/**
 * Positions disponibles dans le layout.
 *
 * Une position d'item est FIGEE dans le layout : seules sa valeur et son opacite
 * changent a l'execution. Avec une grille a l'ecart d'un emplacement, centrer 1,
 * 2 ou 3 avatars tomberait forcement a cote. La grille avance donc d'un
 * DEMI-emplacement, ce qui permet a chaque configuration centree de tomber
 * juste : 3 positions pour 1 avatar, 2 pour 2, 1 pour 3, 0 pour 4.
 */
export const GRID_SLOTS = 7;

/**
 * Diametre de l'avatar.
 *
 * C'est le maximum exploitable : la toile fait 50 px de haut et il faut loger
 * l'anneau de part et d'autre. 44 + 2 x 3 = 50, soit toute la hauteur.
 */
export const AVATAR = 44;
/** Diametre du cadre, et donc bord exterieur de l'anneau. */
export const CIRCLE = 50;
/** Epaisseur de l'anneau. */
export const RING_WIDTH = 3;
/** Ecart entre deux emplacements. */
export const PITCH = 56;
export const BADGE = 18;

export const ROW_WIDTH = CIRCLE + (VISIBLE_SLOTS - 1) * PITCH;
export const START_X = Math.round((WIDTH - ROW_WIDTH) / 2);
export const FRAME_Y = Math.round((HEIGHT - CIRCLE) / 2);
export const INSET = (CIRCLE - AVATAR) / 2;
export const AVATAR_Y = FRAME_Y + INSET;
export const AVATAR_RADIUS = AVATAR / 2;
export const CIRCLE_RADIUS = CIRCLE / 2;

/** Ecart entre deux positions de la grille : un demi-emplacement. */
export const GRID_STEP = PITCH / 2;

/** Coin superieur gauche de la position `index` de la grille. */
export const slotX = (index: number): number => START_X + index * GRID_STEP;
/** Coin superieur gauche de l'avatar de la position `index`. */
export const avatarX = (index: number): number => slotX(index) + INSET;

/**
 * Position de depart d'une rangee centree de `count` avatars.
 *
 * Les positions occupees sont alors `depart + 2i`. La rangee se retrouve centree
 * a un demi-emplacement pres, ce qui est invisible sur 232 px.
 */
export function centeredStart(count: number): number {
	return Math.max(0, VISIBLE_SLOTS - count);
}

// --- Couleurs ----------------------------------------------------------------

export const DEFAULT_BACKGROUND = "#000000";
export const CARD_BORDER = "#2b2d31";
export const SPEAKING_COLOR = "#23a55a";

/**
 * Couleurs des annonces d'arrivee, de depart et de changement de salon.
 *
 * Les coupures n'en font plus partie : elles ont leur propre voile.
 */
export const ALERT_ACCENTS: Record<string, string> = {
	joined: "#23a55a",
	left: "#ed4245",
	channel: "#1e1f22"
};

/**
 * Couleurs des coupures : rouges dans les deux cas.
 *
 * Ce qui distingue le micro du casque, c'est le pictogramme et le texte.
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
 * Nom du salon, annonce seul et en grand.
 *
 * Item dedie plutot que le texte d'etat : celui-ci occupe la moitie haute de la
 * toile, ce qui laisserait le nom visiblement decale vers le haut s'il etait
 * seul a l'ecran.
 */
export const CHANNEL_TEXT_X = 6;
export const CHANNEL_TEXT_Y = 8;
export const CHANNEL_TEXT_WIDTH = WIDTH - 12;
export const CHANNEL_TEXT_HEIGHT = 34;
export const CHANNEL_FONT_SIZE = 22;
export const CHANNEL_FONT_WEIGHT = 700;

// --- Voile de rappel ---------------------------------------------------------

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
 * Ordres de superposition, du fond vers l'avant.
 *
 * Chaque position de la grille occupe sa PROPRE plage d'ordres, et ce n'est pas
 * un detail : les positions sont espacees d'un demi-emplacement alors que les
 * cadres font un emplacement plein, donc deux positions voisines se chevauchent
 * forcement. A ordre egal, un chevauchement fait echouer le rendu du layout
 * ENTIER : plus rien ne s'affiche.
 *
 * Deux positions voisines ne sont jamais visibles en meme temps, puisque les
 * positions occupees avancent de deux crans. L'ordre de peinture entre elles
 * n'a donc aucune incidence visuelle.
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

/** Sous-chemin d'un disque, utilisable dans un chemin rempli en `evenodd`. */
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
 * Cadre pose sur l'avatar.
 *
 * Deux contraintes se croisent.
 *
 * 1. Le trou doit faire EXACTEMENT le diametre de l'avatar, c'est-a-dire son
 *    cercle inscrit. Un trou plus grand ne coupe pas les coins et l'avatar
 *    ressort en carre aux coins arrondis.
 *
 * 2. La couverture ne doit PAS depasser l'emprise de l'avatar. Le cadre occupe
 *    toute la hauteur de la toile : une couverture carree de sa taille entiere
 *    deborderait de la carte et effacerait ses coins arrondis. Elle est donc
 *    limitee a l'emprise de l'avatar, ce qui la reduit a ses quatre coins.
 *
 * Consequence : l'anneau chevauche la couronne de ces coins, il est donc dessine
 * APRES la couverture. Dans l'autre ordre, il serait recouvert.
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
 * Pictogramme de coupure, partage par le badge et le voile de rappel.
 *
 * Un seul trace pour les deux usages : le badge l'entoure d'un disque colore, le
 * voile le pose seul, en blanc, a cote du texte.
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
         <rect x="16.3" y="12.4" width="3.7" height="6.4" rx="1.7" fill="#fff"/>`;
}

/** Couleur d'une coupure, avec echec explicite si la cle n'existe pas. */
export function cutColor(kind: string): string {
	const color = CUT_COLORS[kind];
	if (color === undefined) {
		throw new Error(`Couleur de coupure inconnue : ${kind}`);
	}
	return color;
}

/**
 * Badge d'etat, en bas a droite de l'avatar.
 *
 * Rouge pour les deux coupures : c'est le pictogramme qui indique s'il s'agit du
 * micro ou du casque. Le casque prime, car il coupe aussi le micro.
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

/** Carte opaque des annonces : elle doit masquer la rangee d'avatars. */
export function alertBackgroundSvg(): string {
	return svg(
		WIDTH,
		HEIGHT,
		`  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="10" fill="${DEFAULT_BACKGROUND}" stroke="${CARD_BORDER}"/>`
	);
}

/** Fond opaque du voile de rappel. */
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

/** Avatar de repli, quand l'image est introuvable. */
export function placeholderSvg(): string {
	const grey = "#6b6f76";
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR}" height="${AVATAR}">
  <circle cx="${AVATAR_RADIUS}" cy="${AVATAR_RADIUS}" r="${AVATAR_RADIUS}" fill="${CARD_BORDER}"/>
  <circle cx="${AVATAR_RADIUS}" cy="${AVATAR_RADIUS - 4}" r="5.4" fill="${grey}"/>
  <path d="M${AVATAR_RADIUS} ${AVATAR_RADIUS + 3}c6.2 0 11.2 4.6 11.2 10.2H${AVATAR_RADIUS - 11.2}c0-5.6 5-10.2 11.2-10.2z" fill="${grey}"/>
</svg>
`;
}

// --- Theme dependant de la couleur choisie -----------------------------------

/** Normalise une couleur en `#rrggbb`, ou renvoie la valeur par defaut. */
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

/** Cle de dossier pour une couleur : c'est elle qui invalide le rendu. */
export function themeKey(color: string): string {
	return normalizeColor(color).slice(1);
}

/**
 * Assets a reecrire quand la couleur de fond change.
 *
 * Le nom du fichier contient la couleur. C'est volontaire : Stream Deck ne
 * relit un pixmap que si son chemin change, donc reecrire le meme fichier
 * laisserait l'ancienne couleur a l'ecran.
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

/** Chemins des assets de theme, une fois ecrits. */
export function themePaths(color: string): { card: string; frame: string; frameSpeaking: string } {
	const key = themeKey(color);
	return {
		card: `imgs/infobar/theme/card-${key}.svg`,
		frame: `imgs/infobar/theme/frame-${key}.svg`,
		frameSpeaking: `imgs/infobar/theme/frame-speaking-${key}.svg`
	};
}
