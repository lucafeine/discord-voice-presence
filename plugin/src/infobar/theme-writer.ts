/**
 * Writes assets that depend on the background color.
 *
 * The card and frames carry the chosen color. Since Stream Deck re-reads a
 * pixmap only when its PATH changes, the file name contains the color:
 * rewriting the same file would leave the old color on screen.
 *
 * Writing happens in the plugin folder, which is allowed and avoids relying on
 * SVG data URIs, whose support is not verified.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../discord/log.js";
import { DEFAULT_BACKGROUND, normalizeColor, themeAssets, themePaths } from "./theme.js";

/**
 * Plugin root.
 *
 * The bundle is compiled to `bin/plugin.js`, so the parent folder of the current
 * file is the plugin root.
 */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface ThemeFiles {
	card: string;
	frame: string;
	frameSpeaking: string;
}

const written = new Set<string>();

/**
 * Ensures the assets for this color exist and returns their paths.
 *
 * The result is memoized: files are written only once per color and per run.
 */
export function ensureTheme(backgroundColor: unknown): ThemeFiles {
	const color = normalizeColor(backgroundColor);
	const key = color.slice(1);

	if (!written.has(key)) {
		try {
			for (const asset of themeAssets(color)) {
				const file = path.join(PLUGIN_ROOT, asset.path);
				if (fs.existsSync(file)) continue;

				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, asset.svg);
			}
			written.add(key);
			log.info(`Theme applied: ${color} (root ${PLUGIN_ROOT})`);
		} catch (error) {
			// Without a written theme, fall back to the layout's theme: the color
			// will not be the requested one, but the display stays correct.
			// Returning the requested color paths would point to missing files
			// and could make the whole layout fail to render.
			log.error(`Cannot write the theme: ${String(error)}`);
			return themePaths(DEFAULT_BACKGROUND);
		}
	}

	return themePaths(color);
}
