/**
 * Checks the localization files.
 *
 * Every Stream Deck language falls back to English, so `en.json` is the
 * reference. Each other locale must expose exactly the same keys; missing or
 * extra keys are reported before packaging.
 *
 * Usage: npm run locales
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lucas.discord-voice-presence.sdPlugin");
const manifest = JSON.parse(fs.readFileSync(path.join(plugin, "manifest.json"), "utf8"));

const languages = ["fr", "es"];

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

const en = readLocale("en");

if (typeof en.Name !== "string" || en.Name === "") {
	throw new Error("en.json must define a Name.");
}
if (typeof en.Description !== "string" || en.Description.length < 250) {
	throw new Error("en.json Description must contain at least 250 characters.");
}

const reference = flatten(en.Localization ?? {});

for (const language of languages) {
	const locale = readLocale(language);

	if (typeof locale.Name !== "string" || locale.Name === "") {
		throw new Error(`${language}.json must define a Name.`);
	}
	if (typeof locale.Description !== "string" || locale.Description.length < 250) {
		throw new Error(`${language}.json Description must contain at least 250 characters.`);
	}

	for (const action of manifest.Actions) {
		if (en[action.UUID] === undefined) {
			throw new Error(`en.json is missing the ${action.UUID} action.`);
		}
		if (locale[action.UUID] === undefined) {
			throw new Error(`${language}.json is missing the ${action.UUID} action.`);
		}
	}

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
	`locales checked: en, ${languages.join(", ")} (${Object.keys(reference).length} runtime keys)`
);
