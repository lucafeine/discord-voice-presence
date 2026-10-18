/**
 * Ecriture des assets dependant de la couleur de fond.
 *
 * La carte et les cadres portent la couleur choisie. Comme Stream Deck ne relit
 * un pixmap que si son CHEMIN change, le nom du fichier contient la couleur :
 * reecrire le meme fichier laisserait l'ancienne couleur a l'ecran.
 *
 * L'ecriture se fait dans le dossier du plugin, ce qui est autorise et evite
 * d'avoir recours a des data URI SVG, dont le support n'est pas verifie.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../discord/log.js";
import { normalizeColor, themeAssets, themePaths } from "./theme.js";

/**
 * Racine du plugin.
 *
 * Le bundle est compile dans `bin/plugin.js`, donc le dossier parent du fichier
 * en cours d'execution est la racine du plugin.
 */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface ThemeFiles {
	card: string;
	frame: string;
	frameSpeaking: string;
}

const written = new Set<string>();

/**
 * Garantit la presence des assets pour cette couleur, et renvoie leurs chemins.
 *
 * Le resultat est memoise : les fichiers ne sont ecrits qu'une fois par couleur
 * et par execution.
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
			log.info(`Theme applique : ${color} (racine ${PLUGIN_ROOT})`);
		} catch (error) {
			// Sans theme ecrit, on retombe sur celui du layout : la couleur ne
			// sera pas celle demandee, mais l'affichage reste correct.
			log.error(`Ecriture du theme impossible : ${String(error)}`);
			return themePaths(color);
		}
	}

	return themePaths(color);
}
