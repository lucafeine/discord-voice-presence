/**
 * Apercu local du rendu de l'Infobar.
 *
 * Script de developpement uniquement (`sharp` n'est pas embarque dans le
 * plugin). Il compose les MEMES assets SVG que le device, avec des avatars
 * factices volontairement CARRES et bordes de blanc : si les coins disparaissent
 * et que l'image est bien ronde, la geometrie du cadre est correcte.
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lucas.discord-voice-presence.sdPlugin");
const assets = path.join(plugin, "imgs", "infobar");
const outDir = path.join(root, "out");

// Meme geometrie que tools/generate-infobar.mjs
const WIDTH = 232;
const HEIGHT = 50;
const SLOTS = 5;
const AVATAR = 34;
const CIRCLE = 40;
const PITCH = 44;
const BADGE = 15;
const ROW_WIDTH = CIRCLE + (SLOTS - 1) * PITCH;
const START_X = Math.round((WIDTH - ROW_WIDTH) / 2);
const FRAME_Y = Math.round((HEIGHT - CIRCLE) / 2);
const INSET = (CIRCLE - AVATAR) / 2;
const AVATAR_Y = FRAME_Y + INSET;

const slotX = (index) => START_X + index * PITCH;
const avatarX = (index) => slotX(index) + INSET;

// Meme geometrie de surcouche que tools/generate-infobar.mjs
const ALERT_FRAME_X = 10;
const ALERT_FRAME_Y = FRAME_Y;
const ALERT_AVATAR_X = ALERT_FRAME_X + INSET;
const ALERT_TEXT_X = ALERT_FRAME_X + CIRCLE + 12;

// Meme geometrie du voile de rappel
const FLASH_BAR_X = 6;
const FLASH_BAR_Y = 9;
const FLASH_BAR_WIDTH = 3;
const FLASH_BAR_HEIGHT = 32;
const FLASH_ICON = 26;
const FLASH_ICON_X = 15;
const FLASH_ICON_Y = Math.round((HEIGHT - FLASH_ICON) / 2);
const FLASH_TEXT_X = 48;
const FLASH_MESSAGE = { mute: "Vous êtes muet", deafen: "Vous êtes en sourdine" };

const read = (name) => fs.readFileSync(path.join(assets, name));

/** Rend un SVG a une taille donnee. */
const toPng = (svg, width, height) =>
	sharp(svg, { density: 300 }).resize(width, height).png().toBuffer();

/** Avatar factice CARRE et borde : les coins doivent disparaitre. */
async function squareAvatar(label, color, size = 256) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${color}"/>
    <rect x="0" y="0" width="${size}" height="${size}" fill="none" stroke="#ffffff" stroke-width="14"/>
    <text x="50%" y="50%" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="120"
          font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text>
  </svg>`;
	return sharp(Buffer.from(svg)).resize(AVATAR, AVATAR).png().toBuffer();
}

const COLORS = ["#5865f2", "#eb459e", "#57f287", "#fee75c", "#ed4245"];

const ACCENT_COLORS = {
	joined: "#23a55a",
	left: "#ed4245",
	channel: "#1e1f22"
};

/** Rend une alerte : aplat de couleur, avatar eventuel, texte. */
async function composeAlert(layers, alert) {
	const accent = ACCENT_COLORS[alert.kind];

	layers.push({ input: await toPng(read("alert-bg.svg"), WIDTH, HEIGHT), left: 0, top: 0 });
	layers.push({
		input: await sharp({
			create: { width: WIDTH, height: HEIGHT, channels: 4, background: accent }
		})
			.png()
			.toBuffer(),
		left: 0,
		top: 0
	});

	if (alert.name !== undefined) {
		layers.push({
			input: await squareAvatar(alert.name.slice(0, 1).toUpperCase(), COLORS[0]),
			left: ALERT_AVATAR_X,
			top: AVATAR_Y
		});
		layers.push({
			input: await toPng(read(`frame-${alert.kind}.svg`), CIRCLE, CIRCLE),
			left: ALERT_FRAME_X,
			top: FRAME_Y
		});
	}

	const texts =
		alert.name === undefined
			? `<text x="${WIDTH / 2}" y="17" font-family="Segoe UI, Arial, sans-serif" font-size="17"
                 font-weight="600" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${alert.title}</text>
               <text x="${WIDTH / 2}" y="35" font-family="Segoe UI, Arial, sans-serif" font-size="12"
                 fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${alert.detail}</text>`
			: `<text x="${ALERT_TEXT_X}" y="18" font-family="Segoe UI, Arial, sans-serif" font-size="16"
                 font-weight="600" fill="#FFFFFF" dominant-baseline="central">${alert.title}</text>
               <text x="${ALERT_TEXT_X}" y="36" font-family="Segoe UI, Arial, sans-serif" font-size="12"
                 fill="#FFFFFF" dominant-baseline="central">${alert.detail}</text>`;
	layers.push({
		input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${texts}</svg>`))
			.png()
			.toBuffer(),
		left: 0,
		top: 0
	});
}

async function compose({ count, speaking, badge, alert, flash }) {
	const layers = [{ input: await toPng(read("card.svg"), WIDTH, HEIGHT), left: 0, top: 0 }];

	for (let index = 0; index < count && index < SLOTS; index += 1) {
		layers.push({
			input: await squareAvatar(String.fromCharCode(65 + index), COLORS[index]),
			left: avatarX(index),
			top: AVATAR_Y
		});
	}

	for (let index = 0; index < count && index < SLOTS; index += 1) {
		layers.push({
			input: await toPng(read(index === speaking ? "frame-speaking.svg" : "frame.svg"), CIRCLE, CIRCLE),
			left: slotX(index),
			top: FRAME_Y
		});
	}

	if (badge) {
		layers.push({
			input: await toPng(read(`badge-${badge}.svg`), BADGE, BADGE),
			left: avatarX(0) + AVATAR - BADGE + 1,
			top: AVATAR_Y + AVATAR - BADGE + 1
		});
	}
	if (alert) {
		await composeAlert(layers, alert);
	}

	// Voile de rappel : opaque, il masque la rangee, c'est voulu.
	if (flash) {
		layers.push({
			input: await toPng(read(`flash-bg-${flash}.svg`), WIDTH, HEIGHT),
			left: 0,
			top: 0
		});
		layers.push({
			input: await toPng(read("flash-bar.svg"), FLASH_BAR_WIDTH, FLASH_BAR_HEIGHT),
			left: FLASH_BAR_X,
			top: FLASH_BAR_Y
		});
		layers.push({
			input: await toPng(read(`flash-icon-${flash}.svg`), FLASH_ICON, FLASH_ICON),
			left: FLASH_ICON_X,
			top: FLASH_ICON_Y
		});
		layers.push({
			input: await sharp(
				Buffer.from(
					`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
             <text x="${FLASH_TEXT_X}" y="${HEIGHT / 2}" font-family="Segoe UI, Arial, sans-serif"
                   font-size="15" font-weight="600" fill="#FFFFFF" dominant-baseline="central">${FLASH_MESSAGE[flash]}</text>
           </svg>`
				)
			)
				.png()
				.toBuffer(),
			left: 0,
			top: 0
		});
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

const cases = [
	["Rangee : 1 participant", { count: 1 }],
	["Rangee : 3 participants, le 2e parle", { count: 3, speaking: 1 }],
	["Rangee : 5 participants, le 4e parle, badge micro", { count: 5, speaking: 3, badge: "mute" }],
	[
		"Alerte : arrivee",
		{ count: 3, alert: { kind: "joined", name: "Camille", title: "Camille", detail: "a rejoint le vocal" } }
	],
	[
		"Alerte : depart",
		{ count: 3, alert: { kind: "left", name: "Rayan", title: "Rayan", detail: "a quitte le vocal" } }
	],
	[
		"Alerte : salon rejoint (sans avatar)",
		{ count: 0, alert: { kind: "channel", title: "Le cocon des copaings", detail: "『🦜』Parlote" } }
	],
	["Rappel : voile micro coupe (phase visible)", { count: 3, speaking: 1, flash: "mute" }],
	["Rappel : voile casque coupe (phase visible)", { count: 5, badge: "deafen", flash: "deafen" }]
];

fs.mkdirSync(outDir, { recursive: true });

const rendered = [];
for (const [label, options] of cases) {
	rendered.push({ label, png: await compose(options) });
}

const zoom = 3;
const gutter = 10;
const labelHeight = 22;
const rowHeight = HEIGHT * zoom + labelHeight;
const sheetWidth = WIDTH * zoom + gutter * 2;
const sheetHeight = rowHeight * rendered.length + gutter * 2;

const parts = [];
for (const [index, entry] of rendered.entries()) {
	const top = gutter + index * rowHeight;
	parts.push({
		input: Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${labelHeight}">
         <text x="${gutter}" y="${labelHeight / 2}" font-family="Segoe UI, Arial, sans-serif" font-size="13"
               font-weight="600" fill="#949ba4" dominant-baseline="central">${entry.label}</text>
       </svg>`
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
