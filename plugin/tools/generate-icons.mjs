/**
 * Generates the rasterized icons required by Elgato guidelines.
 *
 * Applied rules:
 *   - plugin icon: PNG 256 x 256 and 512 x 512 (@2x);
 *   - Marketplace app icon: PNG 288 x 288;
 *   - category and action icons: monochrome white SVG on a transparent
 *     background (nominal sizes 28 and 20 px);
 *   - key icons: SVG 72 x 72 px.
 *
 * Category, action, and key SVGs are already the final assets: they are only
 * checked here. Only the plugin icon must be rasterized.
 *
 * Usage: npm run icons
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lucafeine.discord-voice-presence.sdPlugin");
const source = path.join(root, "assets", "icons", "plugin.svg");
const marketplace = path.join(root, "marketplace");

const pluginIconSizes = [
	["icon.png", 256],
	["icon@2x.png", 512]
];

// --- Monochrome SVG validation -----------------------------------------------

const svgSpecs = [
	{ file: "imgs/plugin/category-icon.svg", width: 28, height: 28 },
	{ file: "imgs/actions/infobar/icon.svg", width: 20, height: 20 },
	{ file: "imgs/actions/infobar/key.svg", width: 72, height: 72 },
	{ file: "imgs/actions/connect/icon.svg", width: 20, height: 20 },
	{ file: "imgs/actions/connect/key.svg", width: 72, height: 72 }
];

function assertSvg(file, width, height) {
	const contents = fs.readFileSync(path.join(plugin, file), "utf8");
	const size = contents.match(/<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
	if (size === null || Number(size[1]) !== width || Number(size[2]) !== height) {
		throw new Error(`${file} must declare ${width} x ${height} px.`);
	}

	if (!contents.includes('stroke="#FFFFFF"')) {
		throw new Error(`${file} must use a white #FFFFFF stroke.`);
	}

	if (/\bfill="(?!none|#FFFFFF)[^"]+"/i.test(contents)) {
		throw new Error(`${file} must stay monochrome (no colored fill).`);
	}
}

for (const spec of svgSpecs) {
	assertSvg(spec.file, spec.width, spec.height);
}

// --- Plugin icon --------------------------------------------------------------

fs.mkdirSync(marketplace, { recursive: true });

for (const [name, size] of pluginIconSizes) {
	await sharp(source, { density: 384 })
		.resize(size, size)
		.png()
		.toFile(path.join(plugin, "imgs", "plugin", name));
}

// The Marketplace listing icon is a third size, distinct from the plugin icon:
// do not confuse it with icon.png.
await sharp(source, { density: 384 })
	.resize(288, 288)
	.png()
	.toFile(path.join(marketplace, "app-icon-288.png"));

console.log(" plugin icons: 256 px and 512 px");
console.log(" Marketplace icon: 288 px");
console.log(" SVGs checked: category, actions, and keys");
