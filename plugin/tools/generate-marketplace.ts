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
const plugin = path.join(root, "com.lucas.discord-voice-presence.sdPlugin");
const outDir = path.join(root, "marketplace");
const theme = themePaths(DEFAULT_BACKGROUND);

const SLIDE_WIDTH = 1920;
const SLIDE_HEIGHT = 960;

const PALETTE = {
	background: "#0a0c11",
	surface: "#11151d",
	surfaceRaised: "#171c26",
	border: "#2a303d",
	text: "#ffffff",
	muted: "#a9b2c3",
	accent: "#23a55a",
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

const text = (
	width: number,
	height: number,
	body: string
): Buffer => svgLayer(width, height, body);

async function squareAvatar(label: string, color: string, size = 256): Promise<Buffer> {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${color}"/>
    <text x="50%" y="50%" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="120"
          font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text>
  </svg>`;
	return sharp(Buffer.from(svg)).resize(AVATAR, AVATAR).png().toBuffer();
}

const AVATAR_COLORS = [PALETTE.blurple, PALETTE.pink, PALETTE.green, PALETTE.yellow, "#ed4245"] as const;
const AVATAR_LABELS = ["L", "C", "M", "A", "J"] as const;

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
			input: await squareAvatar(
				AVATAR_LABELS[sourceIndex % AVATAR_LABELS.length]!,
				AVATAR_COLORS[sourceIndex % AVATAR_COLORS.length]!
			),
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
		layers.push({
			input: await sharp({
				create: {
					width: WIDTH,
					height: HEIGHT,
					channels: 4,
					background:
						spec.alert.kind === "joined"
							? PALETTE.accent
							: spec.alert.kind === "left"
								? "#ed4245"
								: "#1e1f22"
				}
			})
				.png()
				.toBuffer(),
			left: 0,
			top: 0
		});

		if (spec.alert.name !== undefined) {
			layers.push({
				input: await squareAvatar(spec.alert.name.slice(0, 1).toUpperCase(), PALETTE.blurple),
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
			input: text(
				WIDTH,
				HEIGHT,
				centered
					? `<text x="${CHANNEL_TEXT_X + CHANNEL_TEXT_WIDTH / 2}" y="${CHANNEL_TEXT_Y + CHANNEL_TEXT_HEIGHT / 2}"
                        font-family="Segoe UI, Arial, sans-serif" font-size="${CHANNEL_FONT_SIZE}" font-weight="700"
                        fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${spec.alert.title}</text>`
					: `<text x="${ALERT_TEXT_X}" y="18" font-family="Segoe UI, Arial, sans-serif" font-size="16"
                        font-weight="600" fill="#FFFFFF" dominant-baseline="central">${spec.alert.title}</text>
                       <text x="${ALERT_TEXT_X}" y="36" font-family="Segoe UI, Arial, sans-serif" font-size="12"
                        fill="#FFFFFF" dominant-baseline="central">${spec.alert.detail}</text>`
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
			input: text(
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
			background: { r: 0, g: 0, b: 0, alpha: 1 }
		}
	})
		.composite(layers)
		.png()
		.toBuffer();
}

function background(body: string): Buffer {
	return text(SLIDE_WIDTH, SLIDE_HEIGHT, body);
}

/** Generic rounded panel, to separate previews from the background. */
function panel(x: number, y: number, width: number, height: number, radius = 32): string {
	return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"
              fill="${PALETTE.surface}" stroke="${PALETTE.border}" stroke-width="2"/>`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function pill(x: number, y: number, label: string, accent = false): string {
	const width = 20 + label.length * 12;
	return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="42" rx="21"
          fill="${accent ? "rgba(35,165,90,0.16)" : "rgba(255,255,255,0.06)"}"
          stroke="${accent ? "rgba(35,165,90,0.45)" : "rgba(255,255,255,0.1)"}"/>
    <text x="${x + width / 2}" y="${y + 22}" fill="${accent ? "#8ff0b6" : PALETTE.muted}"
          font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="600"
          text-anchor="middle" dominant-baseline="central">${escapeXml(label)}</text>
  </g>`;
}

async function mockup(
	buffer: Buffer,
	left: number,
	top: number,
	scale: number
): Promise<Overlay> {
	return {
		input: await sharp(buffer)
			.resize(WIDTH * scale, HEIGHT * scale, { kernel: "lanczos3" })
			.png()
			.toBuffer(),
		left,
		top
	};
}

async function hero(): Promise<Buffer> {
	const roster = await composeInfobar({ count: 4, speaking: 2, badge: "mute", badgeIndex: 3 });
	const channel = await composeInfobar({
		count: 0,
		alert: { kind: "channel", title: "late night lounge", detail: "" }
	});

	const bg = background(`
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b0e14"/>
        <stop offset="0.55" stop-color="#0a0c11"/>
        <stop offset="1" stop-color="#121722"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.72" cy="0.38" r="0.55">
        <stop offset="0" stop-color="#23a55a" stop-opacity="0.14"/>
        <stop offset="1" stop-color="#23a55a" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#bg)"/>
    <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#glow)"/>
    ${panel(1000, 178, 760, 604, 36)}
    <text x="150" y="218" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="22" font-weight="600" letter-spacing="4">STREAM DECK NEO  ·  INFOBAR</text>
    <text x="150" y="344" fill="${PALETTE.text}" font-family="Segoe UI, Arial, sans-serif"
          font-size="96" font-weight="700">Voice Presence</text>
    <text x="150" y="414" fill="${PALETTE.accent}" font-family="Segoe UI, Arial, sans-serif"
          font-size="54" font-weight="600">for Discord</text>
    <text x="150" y="512" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="30" font-weight="400">See who is in your voice channel,</text>
    <text x="150" y="556" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="30" font-weight="400">who is speaking, and who is muted.</text>
    ${pill(150, 630, "Live avatars", true)}
    ${pill(342, 630, "Speaking ring")}
    ${pill(544, 630, "Mute & deafen")}
    <text x="1032" y="248" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="600" letter-spacing="2">INFOBAR PREVIEW</text>
    <text x="1032" y="708" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="400">4 participants · 1 speaking · 1 muted</text>
  `);

	return sharp(bg)
		.composite([
			await mockup(roster, 1032, 290, 3),
			await mockup(channel, 1032, 500, 3)
		])
		.png()
		.toBuffer();
}

async function thumbnail(): Promise<Buffer> {
	const roster = await composeInfobar({ count: 4, speaking: 1, badge: "mute", badgeIndex: 2 });
	const bg = background(`
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b0e14"/>
        <stop offset="1" stop-color="#151b27"/>
      </linearGradient>
    </defs>
    <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#bg)"/>
    ${panel(180, 160, 1560, 640, 44)}
    <text x="960" y="292" fill="${PALETTE.text}" font-family="Segoe UI, Arial, sans-serif"
          font-size="82" font-weight="700" text-anchor="middle">Voice Presence for Discord</text>
    <text x="960" y="366" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="30" font-weight="400" text-anchor="middle">Your voice channel, at a glance on the Stream Deck Neo Infobar.</text>
  `);

	return sharp(bg)
		.composite([await mockup(roster, 612, 470, 3)])
		.png()
		.toBuffer();
}

async function gallerySpeaking(): Promise<Buffer> {
	const quiet = await composeInfobar({ count: 3 });
	const live = await composeInfobar({ count: 4, speaking: 1, badge: "mute", badgeIndex: 3 });
	const bg = background(`
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0a0c11"/>
        <stop offset="1" stop-color="#10151f"/>
      </linearGradient>
    </defs>
    <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#bg)"/>
    ${panel(940, 150, 820, 660, 36)}
    <text x="130" y="210" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="22" font-weight="600" letter-spacing="4">WHO IS SPEAKING</text>
    <text x="130" y="320" fill="${PALETTE.text}" font-family="Segoe UI, Arial, sans-serif"
          font-size="68" font-weight="700">Know who is talking</text>
    <text x="130" y="400" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="28" font-weight="400">A green ring moves around the active speaker.</text>
    <text x="130" y="446" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="28" font-weight="400">Muted and deafened participants get a red badge.</text>
    ${pill(130, 520, "Speaking ring", true)}
    ${pill(332, 520, "Mute badge")}
    ${pill(516, 520, "Deafen badge")}
    <text x="990" y="220" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="600" letter-spacing="2">NOBODY SPEAKING</text>
    <text x="990" y="470" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="600" letter-spacing="2">SPEAKING + MUTED</text>
  `);

	return sharp(bg)
		.composite([
			await mockup(quiet, 990, 250, 3),
			await mockup(live, 990, 500, 3)
		])
		.png()
		.toBuffer();
}

async function galleryAlerts(): Promise<Buffer> {
	const channel = await composeInfobar({
		count: 0,
		alert: { kind: "channel", title: "late night lounge", detail: "" }
	});
	const joined = await composeInfobar({
		count: 3,
		alert: { kind: "joined", name: "Camille", title: "Camille", detail: "joined the voice channel" }
	});
	const muted = await composeInfobar({ count: 3, flash: "mute" });
	const bg = background(`
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0a0c11"/>
        <stop offset="1" stop-color="#10151f"/>
      </linearGradient>
    </defs>
    <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#bg)"/>
    ${panel(940, 130, 820, 700, 36)}
    <text x="130" y="210" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="22" font-weight="600" letter-spacing="4">USEFUL FEEDBACK</text>
    <text x="130" y="320" fill="${PALETTE.text}" font-family="Segoe UI, Arial, sans-serif"
          font-size="68" font-weight="700">Stay in the loop</text>
    <text x="130" y="400" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="28" font-weight="400">Arrivals and departures appear for a few seconds.</text>
    <text x="130" y="446" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="28" font-weight="400">The channel name is announced when you join.</text>
    <text x="130" y="492" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="28" font-weight="400">A reminder appears while you are muted or deafened.</text>
    ${pill(130, 566, "Channel announcement", true)}
    ${pill(422, 566, "Mute reminder")}
    <text x="990" y="202" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="600" letter-spacing="2">CHANNEL ANNOUNCEMENT</text>
    <text x="990" y="366" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="600" letter-spacing="2">SOMEONE JOINED</text>
    <text x="990" y="626" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="600" letter-spacing="2">MUTE REMINDER</text>
  `);

	return sharp(bg)
		.composite([
			await mockup(channel, 990, 230, 3),
			await mockup(joined, 990, 394, 3),
			await mockup(muted, 990, 654, 3)
		])
		.png()
		.toBuffer();
}

async function gallerySetup(): Promise<Buffer> {
	const roster = await composeInfobar({ count: 3, speaking: 1 });
	const connectKey = await toPng(
		fs.readFileSync(path.join(plugin, "imgs", "actions", "connect", "key.svg")),
		144,
		144
	);
	const step = (y: number, number: string, title: string, body: string): string => `
    <circle cx="158" cy="${y}" r="28" fill="${PALETTE.surfaceRaised}" stroke="${PALETTE.accent}" stroke-width="3"/>
    <text x="158" y="${y}" fill="${PALETTE.accent}" font-family="Segoe UI, Arial, sans-serif"
          font-size="24" font-weight="700" text-anchor="middle" dominant-baseline="central">${number}</text>
    <text x="210" y="${y - 8}" fill="${PALETTE.text}" font-family="Segoe UI, Arial, sans-serif"
          font-size="28" font-weight="600">${title}</text>
    <text x="210" y="${y + 30}" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="22" font-weight="400">${body}</text>`;

	const bg = background(`
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0a0c11"/>
        <stop offset="1" stop-color="#10151f"/>
      </linearGradient>
    </defs>
    <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#bg)"/>
    ${panel(920, 140, 840, 680, 36)}
    <text x="130" y="210" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="22" font-weight="600" letter-spacing="4">READY IN A MINUTE</text>
    <text x="130" y="320" fill="${PALETTE.text}" font-family="Segoe UI, Arial, sans-serif"
          font-size="68" font-weight="700">Three quick steps</text>
    ${step(450, "1", "Place the Infobar action", "Add \"Voice Channel (Infobar)\" to your Neo.")}
    ${step(590, "2", "Authorize Discord once", "Press \"Reconnect to Discord\" and approve.")}
    ${step(730, "3", "Join a voice channel", "Avatars appear as soon as you connect.")}
    <text x="1360" y="220" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="600" letter-spacing="2" text-anchor="middle">WORKS WITH THE DISCORD PLUGIN FROM ELGATO</text>
    <text x="1360" y="664" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="400" text-anchor="middle">Reconnect to Discord</text>
    <text x="1360" y="724" fill="${PALETTE.muted}" font-family="Segoe UI, Arial, sans-serif"
          font-size="20" font-weight="400" text-anchor="middle">Elgato's plugin keeps its mute, deafen, and join keys.</text>
  `);

	return sharp(bg)
		.composite([
			await mockup(roster, 1360 - (WIDTH * 3) / 2, 280, 3),
			{ input: connectKey, left: 1360 - 72, top: 482 }
		])
		.png()
		.toBuffer();
}

fs.mkdirSync(outDir, { recursive: true });

const files: Array<[string, Buffer]> = [
	["thumbnail-1920x960.png", await thumbnail()],
	["gallery-1-speaking-1920x960.png", await gallerySpeaking()],
	["gallery-2-alerts-1920x960.png", await galleryAlerts()],
	["gallery-3-setup-1920x960.png", await gallerySetup()]
];

for (const [name, contents] of files) {
	fs.writeFileSync(path.join(outDir, name), contents);
}

// The large hero image serves as the first gallery item when provided in
// addition to the thumbnail; it is also kept for the product page.
fs.writeFileSync(path.join(outDir, "gallery-0-hero-1920x960.png"), await hero());

console.log("Marketplace visuals written to marketplace/:");
console.log("  app-icon-288.png");
for (const [name] of files) console.log(`  ${name}`);
console.log("  gallery-0-hero-1920x960.png");
