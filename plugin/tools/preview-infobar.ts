/**
 * Apercu local du rendu de l'Infobar.
 *
 * Script de developpement uniquement (`sharp` n'est pas embarque dans le
 * plugin). Il compose les MEMES assets et la MEME geometrie que le device, avec
 * des avatars factices volontairement carres et bordes de blanc : si les coins
 * disparaissent et que l'image est bien ronde, la geometrie du cadre est bonne.
 *
 * Cela valide la conception, pas le moteur de rendu de Stream Deck : `sharp`
 * rasterise via librsvg, le device a le sien.
 *
 * Usage : npm run preview
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
	ALERT_AVATAR_X,
	ALERT_AVATAR_Y,
	ALERT_FRAME_X,
	ALERT_FRAME_Y,
	ALERT_TEXT_X,
	AVATAR,
	AVATAR_Y,
	BADGE,
	FLASH_BAR_HEIGHT,
	FLASH_BAR_WIDTH,
	FLASH_BAR_X,
	FLASH_BAR_Y,
	FLASH_ICON,
	FLASH_ICON_X,
	FLASH_ICON_Y,
	FLASH_TEXT_X,
	HEIGHT,
	VISIBLE_SLOTS,
	WIDTH,
	avatarX,
	centeredStart,
	slotX,
	DEFAULT_BACKGROUND,
	themePaths
} from "../src/infobar/theme.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lucas.discord-voice-presence.sdPlugin");
const assets = path.join(plugin, "imgs", "infobar");
const outDir = path.join(root, "out");

const read = (name: string): Buffer => fs.readFileSync(path.join(assets, name));

/** Lecture d'un chemin relatif a la racine du plugin, tel que themePaths le rend. */
const readPlugin = (relativePath: string): Buffer => fs.readFileSync(path.join(plugin, relativePath));

/** Assets du theme par defaut, resolus par le module partage. */
const theme = themePaths(DEFAULT_BACKGROUND);

/** Rend un SVG a une taille donnee. */
const toPng = (svg: Buffer, width: number, height: number): Promise<Buffer> =>
	sharp(svg, { density: 300 }).resize(width, height).png().toBuffer();

/** Avatar factice CARRE et borde : les coins doivent disparaitre. */
async function squareAvatar(label: string, color: string, size = 256): Promise<Buffer> {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${color}"/>
    <rect x="0" y="0" width="${size}" height="${size}" fill="none" stroke="#ffffff" stroke-width="14"/>
    <text x="50%" y="50%" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="120"
          font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text>
  </svg>`;
	return sharp(Buffer.from(svg)).resize(AVATAR, AVATAR).png().toBuffer();
}

const COLORS = ["#5865f2", "#eb459e", "#57f287", "#fee75c", "#ed4245"];

const ACCENT_COLORS: Record<string, string> = {
	joined: "#23a55a",
	left: "#ed4245",
	channel: "#1e1f22"
};

const FLASH_MESSAGE: Record<string, string> = {
	mute: "Vous êtes muet",
	deafen: "Vous êtes en sourdine"
};

interface AlertSpec {
	kind: string;
	name?: string;
	title: string;
	detail: string;
}

interface CaseSpec {
	count: number;
	/** Decalage de la fenetre de defilement. */
	offset?: number;
	speaking?: number;
	badge?: string;
	alert?: AlertSpec;
	flash?: string;
}

function textSvg(width: number, height: number, body: string): Promise<Buffer> {
	return sharp(
		Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`)
	)
		.png()
		.toBuffer();
}

/** Rend une annonce : aplat de couleur, avatar eventuel, texte. */
async function composeAlert(layers: sharp.OverlayOptions[], alert: AlertSpec): Promise<void> {
	layers.push({ input: await toPng(read("alert-bg.svg"), WIDTH, HEIGHT), left: 0, top: 0 });
	layers.push({
		input: await sharp({
			create: { width: WIDTH, height: HEIGHT, channels: 4, background: ACCENT_COLORS[alert.kind] ?? "#000000" }
		})
			.png()
			.toBuffer(),
		left: 0,
		top: 0
	});

	if (alert.name !== undefined) {
		layers.push({
			input: await squareAvatar(alert.name.slice(0, 1).toUpperCase(), COLORS[0] ?? "#5865f2"),
			left: ALERT_AVATAR_X,
			top: ALERT_AVATAR_Y
		});
		layers.push({
			input: await toPng(read(`frame-${alert.kind}.svg`), 50, 50),
			left: ALERT_FRAME_X,
			top: ALERT_FRAME_Y
		});
	}

	const centered = alert.name === undefined;
	const body = centered
		? `<text x="${WIDTH / 2}" y="17" font-family="Segoe UI, Arial, sans-serif" font-size="17"
             font-weight="600" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${alert.title}</text>
           <text x="${WIDTH / 2}" y="35" font-family="Segoe UI, Arial, sans-serif" font-size="12"
             fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${alert.detail}</text>`
		: `<text x="${ALERT_TEXT_X}" y="18" font-family="Segoe UI, Arial, sans-serif" font-size="16"
             font-weight="600" fill="#FFFFFF" dominant-baseline="central">${alert.title}</text>
           <text x="${ALERT_TEXT_X}" y="36" font-family="Segoe UI, Arial, sans-serif" font-size="12"
             fill="#FFFFFF" dominant-baseline="central">${alert.detail}</text>`;

	layers.push({ input: await textSvg(WIDTH, HEIGHT, body), left: 0, top: 0 });
}

/** Voile de rappel : opaque, il masque la rangee, c'est voulu. */
async function composeFlash(layers: sharp.OverlayOptions[], kind: string): Promise<void> {
	layers.push({ input: await toPng(read(`flash-bg-${kind}.svg`), WIDTH, HEIGHT), left: 0, top: 0 });
	layers.push({
		input: await toPng(read("flash-bar.svg"), FLASH_BAR_WIDTH, FLASH_BAR_HEIGHT),
		left: FLASH_BAR_X,
		top: FLASH_BAR_Y
	});
	layers.push({
		input: await toPng(read(`flash-icon-${kind}.svg`), FLASH_ICON, FLASH_ICON),
		left: FLASH_ICON_X,
		top: FLASH_ICON_Y
	});
	layers.push({
		input: await textSvg(
			WIDTH,
			HEIGHT,
			`<text x="${FLASH_TEXT_X}" y="${HEIGHT / 2}" font-family="Segoe UI, Arial, sans-serif"
             font-size="15" font-weight="600" fill="#FFFFFF" dominant-baseline="central">${FLASH_MESSAGE[kind] ?? ""}</text>`
		),
		left: 0,
		top: 0
	});
}

async function compose(spec: CaseSpec): Promise<Buffer> {
	const layers: sharp.OverlayOptions[] = [
		{ input: await toPng(readPlugin(theme.card), WIDTH, HEIGHT), left: 0, top: 0 }
	];

	// Meme regle que le plugin : centre tant que tout tient, sinon fenetre
	// alignee a gauche.
	const scrolling = spec.count > VISIBLE_SLOTS;
	const shown = scrolling ? Math.min(VISIBLE_SLOTS, spec.count) : spec.count;
	const start = scrolling ? 0 : centeredStart(shown);

	for (let index = 0; index < shown; index += 1) {
		const slot = start + index * 2;
		layers.push({
			input: await squareAvatar(String.fromCharCode(65 + ((spec.offset ?? 0) + index) % Math.max(1, spec.count)), COLORS[((spec.offset ?? 0) + index) % COLORS.length] ?? "#5865f2"),
			left: avatarX(slot),
			top: AVATAR_Y
		});
	}

	for (let index = 0; index < shown; index += 1) {
		const slot = start + index * 2;
		const speaking = index === spec.speaking;
		layers.push({
			input: await toPng(readPlugin(speaking ? theme.frameSpeaking : theme.frame), 50, 50),
			left: slotX(slot),
			top: 0
		});
	}

	if (spec.badge !== undefined) {
		const slot = start;
		layers.push({
			input: await toPng(read(`badge-${spec.badge}.svg`), BADGE, BADGE),
			left: avatarX(slot) + AVATAR - BADGE + 1,
			top: AVATAR_Y + AVATAR - BADGE + 1
		});
	}

	if (spec.alert !== undefined) {
		await composeAlert(layers, spec.alert);
	}

	if (spec.flash !== undefined) {
		await composeFlash(layers, spec.flash);
	}

	return sharp({
		create: {
			width: WIDTH,
			height: HEIGHT,
			channels: 4,
			background: { r: 12, g: 12, b: 14, alpha: 1 }
		}
	})
		.composite(layers)
		.png()
		.toBuffer();
}

const cases: Array<[string, CaseSpec]> = [
	["1 participant : centre", { count: 1 }],
	["2 participants : centres", { count: 2, speaking: 1 }],
	["3 participants : centres", { count: 3, speaking: 1 }],
	["4 participants : rangee pleine, le 3e parle", { count: 4, speaking: 2, badge: "mute" }],
	["5 participants : defilement, fenetre 1", { count: 5 }],
	["5 participants : defilement, fenetre 2", { count: 5, offset: 1, speaking: 0 }],
	[
		"Annonce : arrivee",
		{ count: 3, alert: { kind: "joined", name: "Camille", title: "Camille", detail: "a rejoint le vocal" } }
	],
	[
		"Annonce : salon (sans avatar)",
		{ count: 0, alert: { kind: "channel", title: "Le cocon des copaings", detail: "????Parlote" } }
	],
	["Rappel : micro coupe", { count: 3, speaking: 1, flash: "mute" }],
	["Rappel : casque coupe", { count: 4, badge: "deafen", flash: "deafen" }]
];

fs.mkdirSync(outDir, { recursive: true });

const rendered: Array<{ label: string; png: Buffer }> = [];
for (const [label, spec] of cases) {
	rendered.push({ label, png: await compose(spec) });
}

const zoom = 3;
const gutter = 10;
const labelHeight = 22;
const rowHeight = HEIGHT * zoom + labelHeight;
const sheetWidth = WIDTH * zoom + gutter * 2;
const sheetHeight = rowHeight * rendered.length + gutter * 2;

const parts: sharp.OverlayOptions[] = [];
for (const [index, entry] of rendered.entries()) {
	const top = gutter + index * rowHeight;
	parts.push({
		input: await textSvg(
			sheetWidth,
			labelHeight,
			`<text x="${gutter}" y="${labelHeight / 2}" font-family="Segoe UI, Arial, sans-serif" font-size="13"
               font-weight="600" fill="#949ba4" dominant-baseline="central">${entry.label}</text>`
		),
		left: 0,
		top
	});
	parts.push({
		input: await sharp(entry.png)
			.resize(WIDTH * zoom, HEIGHT * zoom, { kernel: "nearest" })
			.png()
			.toBuffer(),
		left: gutter,
		top: top + labelHeight
	});
}

const sheet = await sharp({
	create: {
		width: sheetWidth,
		height: sheetHeight,
		channels: 4,
		background: { r: 12, g: 12, b: 14, alpha: 1 }
	}
})
	.composite(parts)
	.png()
	.toBuffer();

const file = path.join(outDir, "infobar-preview.png");
fs.writeFileSync(file, sheet);
console.log(`apercu ecrit : ${path.relative(root, file)}`);
