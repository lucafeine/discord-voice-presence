/**
 * Generates the Marketplace listing visuals.
 *
 * Applied Elgato constraints:
 *   - app icon: PNG 288 x 288;
 *   - thumbnail and gallery: PNG 1920 x 960;
 *   - English text, legible, without external links or "official" claims;
 *   - visuals that show the product itself, not a third-party brand.
 *
 * Infobar previews are composed with the SAME geometry and SAME assets as the
 * plugin. They are not screenshots: they avoid showing a fake device or
 * claiming hardware accuracy.
 *
 * Usage: npm run marketplace
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
	CHANNEL_FONT_SIZE,
	CHANNEL_TEXT_HEIGHT,
	CHANNEL_TEXT_WIDTH,
	CHANNEL_TEXT_X,
	CHANNEL_TEXT_Y,
	DEFAULT_BACKGROUND,
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
	themePaths
} from "../src/infobar/theme.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lucafeine.discord-voice-presence.sdPlugin");
const outDir = path.join(root, "marketplace");
const theme = themePaths(DEFAULT_BACKGROUND);

const SLIDE_WIDTH = 1920;
const SLIDE_HEIGHT = 960;
const MARGIN = 120;
const RIGHT_X = 1010;
const RIGHT_WIDTH = 780;

const PALETTE = {
	background: "#080a0f",
	backgroundAlt: "#0d1118",
	surface: "#10141c",
	border: "#283040",
	text: "#ffffff",
	muted: "#9aa5b8",
	dim: "#5f6b7e",
	accent: "#23a55a",
	accentSoft: "#8ff0b6",
	danger: "#ed4245",
	blurple: "#5865f2",
	pink: "#eb459e",
	green: "#57f287",
	yellow: "#fee75c"
};

type Overlay = sharp.OverlayOptions;

const readPlugin = (relativePath: string): Buffer =>
	fs.readFileSync(path.join(plugin, relativePath));

const toPng = (svg: Buffer, width: number, height: number): Promise<Buffer> =>
	sharp(svg, { density: 300 }).resize(width, height).png().toBuffer();

const svgLayer = (width: number, height: number, body: string): Buffer =>
	Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`
	);

const escapeXml = (value: string): string =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

interface AvatarSpec {
	label: string;
	from: string;
	to: string;
}

const AVATARS: readonly AvatarSpec[] = [
	{ label: "L", from: "#5b6cff", to: "#8b5cf6" },
	{ label: "C", from: "#ff5c8a", to: "#ff7a59" },
	{ label: "M", from: "#20c997", to: "#4ade80" },
	{ label: "A", from: "#f6c453", to: "#f59e0b" }
];

async function avatar(spec: AvatarSpec): Promise<Buffer> {
	const size = 256;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="avatar" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${spec.from}"/>
        <stop offset="1" stop-color="${spec.to}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#avatar)"/>
    <circle cx="${size * 0.28}" cy="${size * 0.2}" r="${size * 0.55}" fill="#ffffff" opacity="0.08"/>
    <text x="50%" y="50%" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="104"
          font-weight="600" text-anchor="middle" dominant-baseline="central">${spec.label}</text>
  </svg>`;
	return sharp(Buffer.from(svg)).resize(AVATAR, AVATAR).png().toBuffer();
}

interface InfobarSpec {
	count: number;
	offset?: number;
	speaking?: number;
	badge?: "mute" | "deafen";
	badgeIndex?: number;
	alert?: {
		kind: "joined" | "left" | "channel";
		name?: string;
		title: string;
		detail: string;
	};
	flash?: "mute" | "deafen";
}

/** Composes an avatar row, exactly like the Neo layout engine. */
async function composeInfobar(spec: InfobarSpec): Promise<Buffer> {
	const layers: Overlay[] = [
		{ input: await toPng(readPlugin(theme.card), WIDTH, HEIGHT), left: 0, top: 0 }
	];

	const scrolling = spec.count > VISIBLE_SLOTS;
	const shown = scrolling ? Math.min(VISIBLE_SLOTS, spec.count) : spec.count;
	const start = scrolling ? 0 : centeredStart(shown);

	for (let index = 0; index < shown; index += 1) {
		const slot = start + index * 2;
		const sourceIndex = (spec.offset ?? 0) + index;
		layers.push({
			input: await avatar(AVATARS[sourceIndex % AVATARS.length]!),
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
		const badgeSlot = start + (spec.badgeIndex ?? 0) * 2;
		layers.push({
			input: await toPng(readPlugin(`imgs/infobar/badge-${spec.badge}.svg`), BADGE, BADGE),
			left: avatarX(badgeSlot) + AVATAR - BADGE + 1,
			top: AVATAR_Y + AVATAR - BADGE + 1
		});
	}

	if (spec.alert !== undefined) {
		layers.push({ input: await toPng(readPlugin("imgs/infobar/alert-bg.svg"), WIDTH, HEIGHT), left: 0, top: 0 });
		// The accent comes from the SAME asset as the plugin: a rounded rectangle.
		// A plain solid fill here would show square corners on the device preview.
		layers.push({
			input: await toPng(readPlugin(`imgs/infobar/accent-${spec.alert.kind}.svg`), WIDTH, HEIGHT),
			left: 0,
			top: 0
		});

		if (spec.alert.name !== undefined) {
			layers.push({
				input: await avatar(AVATARS[0]!),
				left: ALERT_AVATAR_X,
				top: ALERT_AVATAR_Y
			});
			layers.push({
				input: await toPng(readPlugin(`imgs/infobar/frame-${spec.alert.kind}.svg`), 50, 50),
				left: ALERT_FRAME_X,
				top: ALERT_FRAME_Y
			});
		}

		const centered = spec.alert.name === undefined;
		layers.push({
			input: svgLayer(
				WIDTH,
				HEIGHT,
				centered
					? `<text x="${CHANNEL_TEXT_X + CHANNEL_TEXT_WIDTH / 2}" y="${CHANNEL_TEXT_Y + CHANNEL_TEXT_HEIGHT / 2}"
                        font-family="Segoe UI, Arial, sans-serif" font-size="${CHANNEL_FONT_SIZE}" font-weight="700"
                        fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${escapeXml(spec.alert.title)}</text>`
					: `<text x="${ALERT_TEXT_X}" y="18" font-family="Segoe UI, Arial, sans-serif" font-size="16"
                        font-weight="600" fill="#FFFFFF" dominant-baseline="central">${escapeXml(spec.alert.title)}</text>
                       <text x="${ALERT_TEXT_X}" y="36" font-family="Segoe UI, Arial, sans-serif" font-size="12"
                        fill="#FFFFFF" dominant-baseline="central">${escapeXml(spec.alert.detail)}</text>`
			),
			left: 0,
			top: 0
		});
	}

	if (spec.flash !== undefined) {
		layers.push({
			input: await toPng(readPlugin(`imgs/infobar/flash-bg-${spec.flash}.svg`), WIDTH, HEIGHT),
			left: 0,
			top: 0
		});
		layers.push({
			input: await toPng(readPlugin("imgs/infobar/flash-bar.svg"), FLASH_BAR_WIDTH, FLASH_BAR_HEIGHT),
			left: FLASH_BAR_X,
			top: FLASH_BAR_Y
		});
		layers.push({
			input: await toPng(readPlugin(`imgs/infobar/flash-icon-${spec.flash}.svg`), FLASH_ICON, FLASH_ICON),
			left: FLASH_ICON_X,
			top: FLASH_ICON_Y
		});
		layers.push({
			input: svgLayer(
				WIDTH,
				HEIGHT,
				`<text x="${FLASH_TEXT_X}" y="${HEIGHT / 2}" font-family="Segoe UI, Arial, sans-serif"
                   font-size="15" font-weight="600" fill="#FFFFFF" dominant-baseline="central">${
										spec.flash === "mute" ? "You are muted" : "You are deafened"
									}</text>`
			),
			left: 0,
			top: 0
		});
	}

	return sharp({
		create: {
			width: WIDTH,
			height: HEIGHT,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		}
	})
		.composite(layers)
		.png()
		.toBuffer();
}

function background(): string {
	return `<defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${PALETTE.background}"/>
        <stop offset="0.55" stop-color="${PALETTE.backgroundAlt}"/>
        <stop offset="1" stop-color="#131b28"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.76" cy="0.28" r="0.62">
        <stop offset="0" stop-color="${PALETTE.accent}" stop-opacity="0.11"/>
        <stop offset="1" stop-color="${PALETTE.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#bg)"/>
    <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#glow)"/>`;
}

function card(x: number, y: number, width: number, height: number): string {
	return `<rect x="${x + 8}" y="${y + 14}" width="${width}" height="${height}" rx="32"
              fill="#000000" opacity="0.28"/>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="32"
          fill="${PALETTE.surface}" stroke="${PALETTE.border}" stroke-width="2"/>`;
}

function eyebrow(text: string, x: number, y: number, anchor = "start"): string {
	return `<text x="${x}" y="${y}" fill="${PALETTE.dim}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="600" letter-spacing="3" text-anchor="${anchor}">${escapeXml(text)}</text>`;
}

function title(text: string, x: number, y: number, size = 76, anchor = "start"): string {
	return `<text x="${x}" y="${y}" fill="${PALETTE.text}" font-family="Segoe UI, Arial, sans-serif"
          font-size="${size}" font-weight="700" text-anchor="${anchor}">${escapeXml(text)}</text>`;
}

function body(text: string, x: number, y: number, anchor = "start", fill = PALETTE.muted): string {
	return `<text x="${x}" y="${y}" fill="${fill}" font-family="Segoe UI, Arial, sans-serif"
          font-size="27" font-weight="400" text-anchor="${anchor}">${escapeXml(text)}</text>`;
}

function caption(text: string, x: number, y: number, anchor = "start"): string {
	return `<text x="${x}" y="${y}" fill="${PALETTE.dim}" font-family="Segoe UI, Arial, sans-serif"
          font-size="18" font-weight="400" text-anchor="${anchor}">${escapeXml(text)}</text>`;
}

function feature(
	x: number,
	y: number,
	color: string,
	heading: string,
	description: string
): string {
	return `<circle cx="${x + 6}" cy="${y - 7}" r="7" fill="${color}"/>
    <text x="${x + 28}" y="${y}" fill="${PALETTE.text}" font-family="Segoe UI, Arial, sans-serif"
          font-size="24" font-weight="600">${escapeXml(heading)}</text>
    <text x="${x + 28}" y="${y + 30}" fill="${PALETTE.dim}" font-family="Segoe UI, Arial, sans-serif"
          font-size="19" font-weight="400">${escapeXml(description)}</text>`;
}

function footer(left: string, right: string): string {
	return `<line x1="${MARGIN}" y1="846" x2="${SLIDE_WIDTH - MARGIN}" y2="846"
          stroke="#1d2431" stroke-width="1"/>
    ${caption(left, MARGIN, 884)}
    ${caption(right, SLIDE_WIDTH - MARGIN, 884, "end")}`;
}

async function preview(buffer: Buffer, left: number, top: number, scale: number): Promise<Overlay> {
	return {
		input: await sharp(buffer)
			.resize(Math.round(WIDTH * scale), Math.round(HEIGHT * scale), { kernel: "lanczos3" })
			.png()
			.toBuffer(),
		left: Math.round(left),
		top: Math.round(top)
	};
}

/** Renders a large Infobar inside a clean product card. */
async function previewCard(
	spec: InfobarSpec,
	label: string,
	captionText: string,
	options: { y?: number; x?: number; width?: number; height?: number } = {}
): Promise<{ background: string; overlay: Overlay }> {
	const cardX = options.x ?? RIGHT_X;
	const cardY = options.y ?? 270;
	const cardW = options.width ?? RIGHT_WIDTH;
	const cardH = options.height ?? 420;
	const previewScale = 3;
	const previewWidth = WIDTH * previewScale;
	const previewX = cardX + Math.round((cardW - previewWidth) / 2);
	const previewY = cardY + 96;

	return {
		background: `${card(cardX, cardY, cardW, cardH)}
      ${eyebrow(label, previewX, cardY + 54)}
      ${caption(captionText, previewX, cardY + cardH - 42)}`,
		overlay: await preview(await composeInfobar(spec), previewX, previewY, previewScale)
	};
}

async function gallerySpeaking(): Promise<Buffer> {
	const previewData = await previewCard(
		{ count: 4, speaking: 1, badge: "mute", badgeIndex: 3 },
		"LIVE INFOBAR",
		"4 participants · 1 speaking · 1 muted"
	);

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}">
    ${background()}
    ${eyebrow("SPEAKING & STATUS", MARGIN, 210)}
    ${title("Know who is talking", MARGIN, 336, 72)}
    ${body("A green ring follows the active speaker.", MARGIN, 420)}
    ${body("Red badges show muted or deafened participants.", MARGIN, 460)}
    ${feature(MARGIN, 560, PALETTE.accent, "Speaking ring", "Moves around the person talking.")}
    ${feature(MARGIN, 640, PALETTE.danger, "Mute badge", "A red microphone badge.")}
    ${feature(MARGIN, 720, PALETTE.danger, "Deafen badge", "A red headset badge.")}
    ${previewData.background}
    ${footer("Voice Presence for Discord", "Works with the Discord plugin from Elgato")}
  </svg>`;

	return sharp(Buffer.from(svg)).composite([previewData.overlay]).png().toBuffer();
}

async function galleryAlerts(): Promise<Buffer> {
	// Every alert the plugin can produce: the three announcements, then the two
	// cut reminders.
	const cards: Array<{ label: string; caption: string; spec: InfobarSpec }> = [
		{
			label: "CHANNEL",
			caption: "Announced once when you join.",
			spec: { count: 0, alert: { kind: "channel", title: "late night lounge", detail: "" } }
		},
		{
			label: "SOMEONE JOINED",
			caption: "Shown for a few seconds.",
			spec: {
				count: 3,
				alert: {
					kind: "joined",
					name: "Camille",
					title: "Camille",
					detail: "joined the voice channel"
				}
			}
		},
		{
			label: "SOMEONE LEFT",
			caption: "Shown for a few seconds.",
			spec: {
				count: 3,
				alert: { kind: "left", name: "Marc", title: "Marc", detail: "left the voice channel" }
			}
		},
		{
			label: "MUTE REMINDER",
			caption: "Recalls a cut microphone.",
			spec: { count: 3, flash: "mute" }
		},
		{
			label: "DEAFEN REMINDER",
			caption: "Recalls a cut headset.",
			spec: { count: 4, flash: "deafen" }
		}
	];

	const overlays: Overlay[] = [];
	const pieces: string[] = [];

	// Three cards on the first row, two centered on the second: five previews
	// would not fit one row at a readable size.
	const cardW = 533;
	const cardH = 224;
	const gapX = 40;
	const gapY = 32;
	const startY = 318;
	const scale = 2;
	const previewWidth = WIDTH * scale;
	const rowWidth = (count: number): number => count * cardW + (count - 1) * gapX;

	for (const [index, entry] of cards.entries()) {
		const firstRow = index < 3;
		const column = firstRow ? index : index - 3;
		const rowCount = firstRow ? 3 : 2;
		const cardX = firstRow ? MARGIN : Math.round((SLIDE_WIDTH - rowWidth(rowCount)) / 2);
		const cardY = startY + (firstRow ? 0 : cardH + gapY);
		const x = cardX + column * (cardW + gapX);

		pieces.push(card(x, cardY, cardW, cardH));
		pieces.push(eyebrow(entry.label, x + 28, cardY + 40));
		pieces.push(caption(entry.caption, x + 28, cardY + cardH - 26));
		overlays.push(
			await preview(
				await composeInfobar(entry.spec),
				x + Math.round((cardW - previewWidth) / 2),
				cardY + 62,
				scale
			)
		);
	}

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}">
    ${background()}
    ${eyebrow("ALERTS & REMINDERS", MARGIN, 136)}
    ${title("Never miss a moment", MARGIN, 214, 60)}
    ${body("Arrivals, departures, the channel name, and a reminder while you are cut.", MARGIN, 268)}
    ${pieces.join("\n")}
    ${footer("Voice Presence for Discord", "Works with the Discord plugin from Elgato")}
  </svg>`;

	return sharp(Buffer.from(svg)).composite(overlays).png().toBuffer();
}

async function gallerySetup(): Promise<Buffer> {
	const previewData = await previewCard(
		{ count: 3, speaking: 1 },
		"LIVE INFOBAR",
		"Works alongside the Discord plugin from Elgato"
	);

	const step = (y: number, number: string, heading: string, description: string): string => `
    <circle cx="${MARGIN + 20}" cy="${y}" r="28" fill="${PALETTE.surface}" stroke="${PALETTE.accent}" stroke-width="2"/>
    <text x="${MARGIN + 20}" y="${y}" fill="${PALETTE.accentSoft}" font-family="Segoe UI, Arial, sans-serif"
          font-size="22" font-weight="700" text-anchor="middle" dominant-baseline="central">${number}</text>
    <text x="${MARGIN + 72}" y="${y - 6}" fill="${PALETTE.text}" font-family="Segoe UI, Arial, sans-serif"
          font-size="26" font-weight="600">${escapeXml(heading)}</text>
    <text x="${MARGIN + 72}" y="${y + 28}" fill="${PALETTE.dim}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="400">${escapeXml(description)}</text>`;

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}">
    ${background()}
    ${eyebrow("SETUP", MARGIN, 210)}
    ${title("Ready in a minute", MARGIN, 336, 72)}
    ${body("Three steps, one authorization.", MARGIN, 420)}
    ${body("Then the Infobar updates on its own.", MARGIN, 460)}
    ${step(530, "1", "Place the Infobar action", "Add Voice Channel (Infobar) to your Neo.")}
    ${step(650, "2", "Authorize Discord once", "Press Reconnect to Discord and approve.")}
    ${step(770, "3", "Join a voice channel", "Avatars appear as soon as you connect.")}
    ${previewData.background}
    ${footer("Voice Presence for Discord", "Works with the Discord plugin from Elgato")}
  </svg>`;

	return sharp(Buffer.from(svg)).composite([previewData.overlay]).png().toBuffer();
}

async function thumbnail(): Promise<Buffer> {
	const previewData = await previewCard(
		{ count: 4, speaking: 2, badge: "mute", badgeIndex: 3 },
		"LIVE INFOBAR",
		"4 participants · 1 speaking · 1 muted",
		{ y: 470, x: 560, width: 800, height: 340 }
	);

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}">
    ${background()}
    ${eyebrow("STREAM DECK NEO · INFOBAR", 960, 176, "middle")}
    ${title("Voice Presence", 960, 300, 88, "middle")}
    <text x="960" y="368" fill="${PALETTE.accent}" font-family="Segoe UI, Arial, sans-serif"
          font-size="48" font-weight="600" text-anchor="middle">for Discord</text>
    ${body("Your voice channel, at a glance.", 960, 432, "middle")}
    ${previewData.background}
    ${footer("Voice Presence for Discord", "Works with the Discord plugin from Elgato")}
  </svg>`;

	return sharp(Buffer.from(svg)).composite([previewData.overlay]).png().toBuffer();
}

fs.mkdirSync(outDir, { recursive: true });

// Remove the previous generated visuals so no stale image survives a redesign.
for (const file of fs.readdirSync(outDir)) {
	if (file.endsWith(".png") && file !== "app-icon-288.png") {
		fs.rmSync(path.join(outDir, file));
	}
}

const files: Array<[string, Buffer]> = [
	["thumbnail-1920x960.png", await thumbnail()],
	["gallery-1-speaking-1920x960.png", await gallerySpeaking()],
	["gallery-2-alerts-1920x960.png", await galleryAlerts()],
	["gallery-3-setup-1920x960.png", await gallerySetup()]
];

for (const [name, contents] of files) {
	fs.writeFileSync(path.join(outDir, name), contents);
}

console.log("Marketplace visuals written to marketplace/:");
console.log("  app-icon-288.png (generated by npm run icons)");
for (const [name] of files) console.log(`  ${name}`);
