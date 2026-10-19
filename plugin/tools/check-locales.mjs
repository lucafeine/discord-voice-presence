/**
 * Checks the localization files against the marketplace metadata.
 *
 * `marketplace/metadata.json` lists the languages shipped with the plugin and
 * mirrors the manifest's author and name. Every Stream Deck language falls back
 * to English, so `en.json` is the reference: each listed language must expose
 * exactly the same keys, and missing or extra keys are reported before
 * packaging.
 *
 * Usage: npm run locales
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lucafeine.discord-voice-presence.sdPlugin");
const manifest = JSON.parse(fs.readFileSync(path.join(plugin, "manifest.json"), "utf8"));
const metadata = JSON.parse(
	fs.readFileSync(path.join(root, "marketplace", "metadata.json"), "utf8")
);

// The metadata is what the Marketplace listing shows: a drift between it and
// the manifest would publish a name or an author that does not match the plugin.
if (metadata.author !== manifest.Author) {
	throw new Error(
		`metadata.json author "${metadata.author}" does not match the manifest author "${manifest.Author}".`
	);
}
if (metadata.name !== manifest.Name) {
	throw new Error(
		`metadata.json name "${metadata.name}" does not match the manifest name "${manifest.Name}".`
	);
}

const languages = metadata.languages;
if (!Array.isArray(languages) || languages.length === 0 || !languages.includes("en")) {
	throw new Error('metadata.json must list the languages and include "en".');
}

const readLocale = (language) =>
	JSON.parse(fs.readFileSync(path.join(plugin, `${language}.json`), "utf8"));

const flatten = (value, prefix = "") => {
	const keys = {};
	for (const [key, child] of Object.entries(value)) {
		const fullKey = prefix === "" ? key : `${prefix}.${key}`;
		if (child !== null && typeof child === "object" && !Array.isArray(child)) {
			Object.assign(keys, flatten(child, fullKey));
		} else {
			keys[fullKey] = child;
		}
	}
	return keys;
};

const locales = new Map(languages.map((language) => [language, readLocale(language)]));
const reference = flatten(locales.get("en").Localization ?? {});

for (const language of languages) {
	const locale = locales.get(language);

	if (typeof locale.Name !== "string" || locale.Name === "") {
		throw new Error(`${language}.json must define a Name.`);
	}
	if (typeof locale.Description !== "string" || locale.Description.length < 250) {
		throw new Error(`${language}.json Description must contain at least 250 characters.`);
	}

	for (const action of manifest.Actions) {
		if (locale[action.UUID] === undefined) {
			throw new Error(`${language}.json is missing the ${action.UUID} action.`);
		}
	}

	if (language === "en") continue;

	const translated = flatten(locale.Localization ?? {});

	const missing = Object.keys(reference).filter((key) => translated[key] === undefined);
	const extra = Object.keys(translated).filter((key) => reference[key] === undefined);

	if (missing.length > 0) {
		throw new Error(`${language}.json is missing translations: ${missing.join(", ")}`);
	}
	if (extra.length > 0) {
		throw new Error(`${language}.json has unknown translations: ${extra.join(", ")}`);
	}

	for (const [key, value] of Object.entries(translated)) {
		if (typeof value !== "string" || value.trim() === "") {
			throw new Error(`${language}.json translation "${key}" must be a non-empty string.`);
		}
	}
}

console.log(
	`locales checked: ${languages.join(", ")} (${Object.keys(reference).length} runtime keys)`
);
