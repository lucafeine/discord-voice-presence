/**
 * Genere les assets SVG et le layout de l'Infobar.
 *
 * Tout est calcule a partir de la geometrie ci-dessous : 18 items positionnes a
 * la main seraient une source d'erreur garantie, et un layout dont un item
 * depasse ou se chevauche au meme zOrder ne s'affiche pas du tout.
 *
 * ## Comment un avatar carre devient rond, sans traitement d'image
 *
 * `sharp` ne peut pas etre embarque dans le plugin (module natif, incompatible
 * avec un bundle unique), donc aucun pixel n'est manipule a l'execution.
 *
 * L'avatar est un carre. Par-dessus, au zOrder superieur, on pose un CADRE de la
 * taille de l'anneau : opaque partout sauf un trou circulaire transparent, et ce
 * trou fait EXACTEMENT le diametre de l'avatar.
 *
 * C'est le point a ne pas rater : le trou doit etre le cercle inscrit de
 * l'avatar. Un trou plus grand ne coupe pas les coins et l'avatar ressort en
 * carre aux coins arrondis. Un trou plus petit rogne l'image.
 *
 * L'anneau vert est donc dessine DANS la bande opaque du cadre, entre le cercle
 * de l'avatar et le bord du cadre, et la couverture des coins ne commence qu'au
 * dela de cette bande.
 *
 *   zOrder 0  carte
 *   zOrder 1  avatars
 *   zOrder 2  cadres (avec ou sans anneau vert)
 *   zOrder 3  badges micro / casque
 *   zOrder 4  texte
 *
 * Usage : npm run assets
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lucas.discord-voice-presence.sdPlugin");
const assetsDir = path.join(plugin, "imgs", "infobar");
const layoutsDir = path.join(plugin, "layouts");

// --- Geometrie ---------------------------------------------------------------

const WIDTH = 232;
const HEIGHT = 50;
const SLOTS = 5;

/** Diametre de l'avatar, et donc du trou du cadre. */
const AVATAR = 34;
/** Diametre du cadre, et donc bord exterieur de l'anneau. */
const CIRCLE = 40;
/** Epaisseur de l'anneau, dans la bande entre l'avatar et le bord du cadre. */
const RING_WIDTH = 3;
/** Ecart entre deux emplacements. */
const PITCH = 44;
const BADGE = 15;

const ROW_WIDTH = CIRCLE + (SLOTS - 1) * PITCH;
const START_X = Math.round((WIDTH - ROW_WIDTH) / 2);
const FRAME_Y = Math.round((HEIGHT - CIRCLE) / 2);
const INSET = (CIRCLE - AVATAR) / 2;
const AVATAR_Y = FRAME_Y + INSET;

const AVATAR_RADIUS = AVATAR / 2;
const CIRCLE_RADIUS = CIRCLE / 2;

const CARD_COLOR = "#000000";
const CARD_BORDER = "#2b2d31";
const SPEAKING_COLOR = "#23a55a";

const slotX = (index) => START_X + index * PITCH;
const avatarX = (index) => slotX(index) + INSET;
const frameX = (index) => slotX(index);

// --- Assets ------------------------------------------------------------------

function cardSvg() {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="10"
        fill="${CARD_COLOR}" stroke="${CARD_BORDER}"/>
</svg>
`;
}

/** Sous-chemin d'un disque, utilisable dans un chemin rempli en `evenodd`. */
function disc(cx, cy, radius) {
	return `M ${cx - radius} ${cy} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0 Z`;
}

/**
 * Cadre pose sur l'avatar.
 *
 * Sans anneau : la couverture part du bord de l'avatar, donc tout le cadre est
 * de la couleur de la carte et seul le disque de l'avatar reste visible.
 *
 * Avec anneau : la couverture ne commence qu'au-dela de la bande de l'anneau,
 * ce qui laisse l'anneau vert apparent autour de l'avatar.
 */
function frameSvg(speaking) {
	const centre = CIRCLE_RADIUS;
	const coverRadius = speaking ? CIRCLE_RADIUS : AVATAR_RADIUS;

	const parts = [];
	if (speaking) {
		const ringRadius = (AVATAR_RADIUS + CIRCLE_RADIUS) / 2;
		parts.push(
			`  <circle cx="${centre}" cy="${centre}" r="${ringRadius}" fill="none" stroke="${SPEAKING_COLOR}" stroke-width="${RING_WIDTH}"/>`
		);
	}

	// Carre plein, moins un disque : la couverture des coins.
	parts.push(
		`  <path d="M 0 0 H ${CIRCLE} V ${CIRCLE} H 0 Z ${disc(centre, centre, coverRadius)}" fill="${CARD_COLOR}" fill-rule="evenodd"/>`
	);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${CIRCLE}" height="${CIRCLE}">
${parts.join("\n")}
</svg>
`;
}

/** Avatar de repli, quand l'image est introuvable. */
function placeholderSvg() {
	const grey = "#6b6f76";
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR}" height="${AVATAR}">
  <circle cx="${AVATAR_RADIUS}" cy="${AVATAR_RADIUS}" r="${AVATAR_RADIUS}" fill="${CARD_BORDER}"/>
  <circle cx="${AVATAR_RADIUS}" cy="${AVATAR_RADIUS - 4}" r="5.4" fill="${grey}"/>
  <path d="M${AVATAR_RADIUS} ${AVATAR_RADIUS + 3}c6.2 0 11.2 4.6 11.2 10.2H${AVATAR_RADIUS - 11.2}c0-5.6 5-10.2 11.2-10.2z" fill="${grey}"/>
</svg>
`;
}

/**
 * Badge d'etat.
 *
 * Priorite au casque : sur Discord, se couper le son coupe aussi le micro,
 * donc "casque" est l'information la plus utile.
 */
function badgeSvg(kind) {
	const fill = kind === "mute" ? "#ed4245" : "#f0b232";

	const glyph =
		kind === "mute"
			? `<g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round">
           <rect x="9.4" y="4.2" width="5.2" height="9.2" rx="2.6"/>
           <path d="M6.9 11.2a5.1 5.1 0 0 0 10.2 0"/>
           <line x1="12" y1="16.4" x2="12" y2="19"/>
         </g>
         <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="${fill}" stroke-width="4.8" stroke-linecap="round"/>
         <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`
			: `<g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round">
           <path d="M5.2 14.2v-2.6a6.8 6.8 0 0 1 13.6 0v2.6"/>
         </g>
         <rect x="4" y="12.4" width="3.7" height="6.4" rx="1.7" fill="#fff"/>
         <rect x="16.3" y="12.4" width="3.7" height="6.4" rx="1.7" fill="#fff"/>`;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="11.5" fill="${fill}" stroke="${CARD_COLOR}" stroke-width="1.5"/>
  ${glyph}
</svg>
`;
}

// --- Layout ------------------------------------------------------------------

function layout() {
	const items = [
		{
			key: "card",
			type: "pixmap",
			rect: [0, 0, WIDTH, HEIGHT],
			value: "imgs/infobar/card.svg",
			zOrder: 0
		}
	];

	for (let index = 0; index < SLOTS; index += 1) {
		items.push({
			key: `avatar${index}`,
			type: "pixmap",
			rect: [avatarX(index), AVATAR_Y, AVATAR, AVATAR],
			value: "",
			opacity: 0,
			zOrder: 1
		});
	}

	for (let index = 0; index < SLOTS; index += 1) {
		items.push({
			key: `frame${index}`,
			type: "pixmap",
			rect: [frameX(index), FRAME_Y, CIRCLE, CIRCLE],
			value: "imgs/infobar/frame.svg",
			opacity: 0,
			zOrder: 2
		});
	}

	for (let index = 0; index < SLOTS; index += 1) {
		items.push({
			key: `badge${index}`,
			type: "pixmap",
			rect: [avatarX(index) + AVATAR - BADGE + 1, AVATAR_Y + AVATAR - BADGE + 1, BADGE, BADGE],
			value: "",
			opacity: 0,
			zOrder: 3
		});
	}

	// Texte : uniquement pour les etats sans avatars (hors vocal, erreur,
	// connexion). Quand des avatars sont affiches, ils occupent toute la surface.
	items.push({
		key: "status",
		type: "text",
		rect: [6, 3, WIDTH - 12, 22],
		value: "",
		font: { size: 17, weight: 600 },
		alignment: "center",
		color: "#FFFFFF",
		"text-overflow": "ellipsis",
		zOrder: 4
	});
	items.push({
		key: "detail",
		type: "text",
		rect: [6, 26, WIDTH - 12, 19],
		value: "",
		font: { size: 12, weight: 400 },
		alignment: "center",
		color: "#A8A8A8",
		"text-overflow": "ellipsis",
		zOrder: 4
	});

	return {
		$schema: "https://schemas.elgato.com/streamdeck/plugins/layout.json",
		id: "voice-presence",
		controller: "Neo",
		items
	};
}

// --- Ecriture ----------------------------------------------------------------

fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(layoutsDir, { recursive: true });

fs.writeFileSync(path.join(assetsDir, "card.svg"), cardSvg());
fs.writeFileSync(path.join(assetsDir, "frame.svg"), frameSvg(false));
fs.writeFileSync(path.join(assetsDir, "frame-speaking.svg"), frameSvg(true));
fs.writeFileSync(path.join(assetsDir, "avatar-placeholder.svg"), placeholderSvg());
fs.writeFileSync(path.join(assetsDir, "badge-mute.svg"), badgeSvg("mute"));
fs.writeFileSync(path.join(assetsDir, "badge-deaf.svg"), badgeSvg("deaf"));

const stale = path.join(assetsDir, "mask.svg");
if (fs.existsSync(stale)) fs.rmSync(stale);

const output = layout();
fs.writeFileSync(path.join(layoutsDir, "voice-presence.json"), `${JSON.stringify(output, null, "\t")}\n`);

console.log("assets ecrits dans imgs/infobar/");
console.log(`layout ecrit : ${output.items.length} items`);
console.log(`avatar ${AVATAR} px, cadre ${CIRCLE} px, anneau ${RING_WIDTH} px, pitch ${PITCH}`);
console.log(`trou du cadre = diametre de l'avatar (${AVATAR}) : c'est le cercle inscrit, condition d'un vrai rond`);
