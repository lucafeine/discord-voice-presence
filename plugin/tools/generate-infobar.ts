/**
 * Generates the fixed Infobar assets and layout.
 *
 * Geometry and the asset factory live in src/infobar/theme.ts, shared with the
 * plugin: the plugin rewrites the card and frames when the user changes the
 * background color. If the two diverged, avatars would be clipped incorrectly.
 *
 * Written in TypeScript and run directly by Node, which strips types: no
 * intermediate build for a development script.
 *
 * Usage: npm run assets
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	ALERT_ACCENTS,
	ALERT_AVATAR_X,
	ALERT_AVATAR_Y,
	ALERT_FRAME_X,
	ALERT_FRAME_Y,
	ALERT_TEXT_WIDTH,
	ALERT_TEXT_X,
	AVATAR,
	AVATAR_Y,
	BADGE,
	CIRCLE,
	CHANNEL_FONT_SIZE,
	CHANNEL_FONT_WEIGHT,
	CHANNEL_TEXT_HEIGHT,
	CHANNEL_TEXT_WIDTH,
	CHANNEL_TEXT_X,
	CHANNEL_TEXT_Y,
	CUT_COLORS,
	FRAME_Y,
	FLASH_BAR_HEIGHT,
	FLASH_BAR_WIDTH,
	FLASH_BAR_X,
	FLASH_BAR_Y,
	FLASH_ICON,
	FLASH_ICON_X,
	FLASH_ICON_Y,
	FLASH_TEXT_WIDTH,
	FLASH_TEXT_X,
	GRID_SLOTS,
	GRID_STEP,
	HEIGHT,
	PITCH,
	RING_WIDTH,
	VISIBLE_SLOTS,
	WIDTH,
	Z,
	avatarZ,
	badgeZ,
	frameZ,
	accentSvg,
	alertBackgroundSvg,
	avatarX,
	badgeSvg,
	cardSvg,
	flashBackgroundSvg,
	flashBarSvg,
	flashIconSvg,
	frameSvg,
	placeholderSvg,
	slotX,
	themeAssets,
	themePaths,
	DEFAULT_BACKGROUND
} from "../src/infobar/theme.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lucafeine.discord-voice-presence.sdPlugin");
const assetsDir = path.join(plugin, "imgs", "infobar");
const layoutsDir = path.join(plugin, "layouts");

function write(relativePath: string, contents: string): void {
	const file = path.join(plugin, relativePath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, contents);
}

// --- Layout ------------------------------------------------------------------

function layout(): object {
	const theme = themePaths(DEFAULT_BACKGROUND);
	const items: object[] = [];

	items.push({
		key: "card",
		type: "pixmap",
		rect: [0, 0, WIDTH, HEIGHT],
		value: theme.card,
		zOrder: Z.card
	});

	for (let index = 0; index < GRID_SLOTS; index += 1) {
		items.push({
			key: `avatar${index}`,
			type: "pixmap",
			rect: [avatarX(index), AVATAR_Y, AVATAR, AVATAR],
			value: "",
			opacity: 0,
			zOrder: avatarZ(index)
		});
	}

	for (let index = 0; index < GRID_SLOTS; index += 1) {
		items.push({
			key: `frame${index}`,
			type: "pixmap",
			rect: [slotX(index), FRAME_Y, 50, 50],
			value: theme.frame,
			opacity: 0,
			zOrder: frameZ(index)
		});
	}

	for (let index = 0; index < GRID_SLOTS; index += 1) {
		items.push({
			key: `badge${index}`,
			type: "pixmap",
			rect: [avatarX(index) + AVATAR - BADGE + 1, AVATAR_Y + AVATAR - BADGE + 1, BADGE, BADGE],
			value: "",
			opacity: 0,
			zOrder: badgeZ(index)
		});
	}

	items.push({
		key: "alertBg",
		type: "pixmap",
		rect: [0, 0, WIDTH, HEIGHT],
		value: "imgs/infobar/alert-bg.svg",
		opacity: 0,
		zOrder: Z.alertBg
	});
	items.push({
		key: "alertAccent",
		type: "pixmap",
		rect: [0, 0, WIDTH, HEIGHT],
		value: "",
		opacity: 0,
		zOrder: Z.alertAccent
	});
	items.push({
		key: "alertAvatar",
		type: "pixmap",
		rect: [ALERT_AVATAR_X, ALERT_AVATAR_Y, AVATAR, AVATAR],
		value: "",
		opacity: 0,
		zOrder: Z.alertAvatar
	});
	items.push({
		key: "alertFrame",
		type: "pixmap",
		rect: [ALERT_FRAME_X, ALERT_FRAME_Y, 50, 50],
		value: "imgs/infobar/frame-joined.svg",
		opacity: 0,
		zOrder: Z.alertFrame
	});
	items.push({
		key: "alertTitle",
		type: "text",
		rect: [ALERT_TEXT_X, 8, ALERT_TEXT_WIDTH, 20],
		value: "",
		font: { size: 16, weight: 600 },
		alignment: "left",
		color: "#FFFFFF",
		"text-overflow": "ellipsis",
		zOrder: Z.alertText
	});
	items.push({
		key: "alertDetail",
		type: "text",
		rect: [ALERT_TEXT_X, 28, ALERT_TEXT_WIDTH, 16],
		value: "",
		font: { size: 12, weight: 400 },
		alignment: "left",
		color: "#FFFFFF",
		"text-overflow": "ellipsis",
		zOrder: Z.alertText
	});

	items.push({
		key: "flashBg",
		type: "pixmap",
		rect: [0, 0, WIDTH, HEIGHT],
		value: "",
		opacity: 0,
		zOrder: Z.flashBg
	});
	items.push({
		key: "flashBar",
		type: "pixmap",
		rect: [FLASH_BAR_X, FLASH_BAR_Y, FLASH_BAR_WIDTH, FLASH_BAR_HEIGHT],
		value: "imgs/infobar/flash-bar.svg",
		opacity: 0,
		zOrder: Z.flashBar
	});
	items.push({
		key: "flashIcon",
		type: "pixmap",
		rect: [FLASH_ICON_X, FLASH_ICON_Y, FLASH_ICON, FLASH_ICON],
		value: "",
		opacity: 0,
		zOrder: Z.flashIcon
	});
	items.push({
		key: "flashText",
		type: "text",
		rect: [FLASH_TEXT_X, 12, FLASH_TEXT_WIDTH, 26],
		value: "",
		font: { size: 15, weight: 600 },
		alignment: "left",
		color: "#FFFFFF",
		"text-overflow": "ellipsis",
		zOrder: Z.flashText
	});

	items.push({
		key: "status",
		type: "text",
		rect: [6, 3, WIDTH - 12, 22],
		value: "",
		font: { size: 17, weight: 600 },
		alignment: "center",
		color: "#FFFFFF",
		"text-overflow": "ellipsis",
		zOrder: Z.status
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
		zOrder: Z.status
	});
	items.push({
		key: "channelName",
		type: "text",
		rect: [CHANNEL_TEXT_X, CHANNEL_TEXT_Y, CHANNEL_TEXT_WIDTH, CHANNEL_TEXT_HEIGHT],
		value: "",
		font: { size: CHANNEL_FONT_SIZE, weight: CHANNEL_FONT_WEIGHT },
		alignment: "center",
		color: "#FFFFFF",
		"text-overflow": "ellipsis",
		zOrder: Z.channelText
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

// Default theme, so the layout is correct even before the action sends
// anything.
for (const asset of themeAssets(DEFAULT_BACKGROUND)) {
	write(asset.path, asset.svg);
}

// Assets independent of the background color.
write("imgs/infobar/badge-mute.svg", badgeSvg("mute"));
write("imgs/infobar/badge-deafen.svg", badgeSvg("deafen"));
write("imgs/infobar/alert-bg.svg", alertBackgroundSvg());
write("imgs/infobar/avatar-placeholder.svg", placeholderSvg());
write("imgs/infobar/flash-bar.svg", flashBarSvg());

for (const [kind, color] of Object.entries(ALERT_ACCENTS)) {
	write(`imgs/infobar/accent-${kind}.svg`, accentSvg(color));
	// Frame matching the overlay: without it, the avatar corner cover would stay
	// the card color and draw a square on the alert.
	write(`imgs/infobar/frame-${kind}.svg`, frameSvg(color));
}

for (const [kind, color] of Object.entries(CUT_COLORS)) {
	write(`imgs/infobar/flash-bg-${kind}.svg`, flashBackgroundSvg(color));
	write(`imgs/infobar/flash-icon-${kind}.svg`, flashIconSvg(kind));
}

// Cleanup: the card and frames moved to theme/, and cuts no longer produce an
// announcement. Leaving stale assets that no longer match the behavior is the
// best way to get confused later.
for (const stale of [
	"card.svg",
	"frame.svg",
	"frame-speaking.svg",
	"accent-mute.svg",
	"accent-deafen.svg",
	"frame-mute.svg",
	"frame-deafen.svg",
	"mask.svg",
	"ring.svg",
	"badge-deaf.svg"
]) {
	const file = path.join(assetsDir, stale);
	if (fs.existsSync(file)) fs.rmSync(file);
}

const output = layout();
write("layouts/voice-presence.json", `${JSON.stringify(output, null, "\t")}\n`);

/**
 * Layout validity check.
 *
 * Two rules Elgato does NOT check in `streamdeck validate`, whose violation
 * produces no message: the layout is simply rejected and nothing appears on the
 * Infobar.
 */
function assertLayoutIsRenderable(items: readonly LayoutItem[]): void {
	for (const item of items) {
		const [x, y, w, h] = item.rect;
		if (x < 0 || y < 0 || x + w > WIDTH || y + h > HEIGHT) {
			throw new Error(`${item.key} is out of bounds: ${JSON.stringify(item.rect)}`);
		}
	}

	for (let a = 0; a < items.length; a += 1) {
		for (let b = a + 1; b < items.length; b += 1) {
			const first = items[a]!;
			const second = items[b]!;
			if (first.zOrder !== second.zOrder) continue;
			if (!overlaps(first.rect, second.rect)) continue;

			throw new Error(
				`${first.key} and ${second.key} overlap at the same zOrder ${first.zOrder}: ` +
					"the whole layout would not render."
			);
		}
	}
}

type LayoutItem = { key: string; rect: [number, number, number, number]; zOrder: number };

function overlaps(
	first: [number, number, number, number],
	second: [number, number, number, number]
): boolean {
	const [ax, ay, aw, ah] = first;
	const [bx, by, bw, bh] = second;
	return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

assertLayoutIsRenderable((output as { items: LayoutItem[] }).items);

const itemCount = (output as { items: unknown[] }).items.length;
console.log("assets written to imgs/infobar/");
console.log(`layout written: ${itemCount} items`);
console.log(`avatar ${AVATAR} px, frame ${CIRCLE} px, ring ${RING_WIDTH} px, pitch ${PITCH}`);
console.log(`grid: ${GRID_SLOTS} positions every ${GRID_STEP} px, start x=${slotX(0)}`);
console.log(`scrolling from ${VISIBLE_SLOTS + 1} participants, window of ${VISIBLE_SLOTS}`);
console.log(`default theme: ${DEFAULT_BACKGROUND}`);
