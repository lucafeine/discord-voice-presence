/**
 * Checks the localization files.
 *
 * Every Stream Deck language falls back to English, so `en.json` is the
 * reference. French must expose exactly the same keys; missing or extra keys are
 * reported before packaging.
 *
 * Usage: npm run locales
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lucas.discord-voice-presence.sdPlugin");
const manifest = JSON.parse(fs.readFileSync(path.join(plugin, "manifest.json"), "utf8"));

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
const fr = readLocale("fr");

if (typeof en.Name !== "string" || en.Name === "") {
	throw new Error("en.json must define a Name.");
}
if (typeof en.Description !== "string" || en.Description.length < 250) {
	throw new Error("en.json Description must contain at least 250 characters.");
}

for (const action of manifest.Actions) {
	if (en[action.UUID] === undefined) {
		throw new Error(`en.json is missing the ${action.UUID} action.`);
	}
	if (fr[action.UUID] === undefined) {
		throw new Error(`fr.json is missing the ${action.UUID} action.`);
	}
}

const reference = flatten(en.Localization ?? {});
const translated = flatten(fr.Localization ?? {});

const missing = Object.keys(reference).filter((key) => translated[key] === undefined);
const extra = Object.keys(translated).filter((key) => reference[key] === undefined);

if (missing.length > 0) {
	throw new Error(`fr.json is missing translations: ${missing.join(", ")}`);
}
if (extra.length > 0) {
	throw new Error(`fr.json has unknown translations: ${extra.join(", ")}`);
}

for (const [language, translations] of [
	["en", reference],
	["fr", translated]
]) {
	for (const [key, value] of Object.entries(translations)) {
		if (typeof value !== "string" || value.trim() === "") {
			throw new Error(`${language}.json translation "${key}" must be a non-empty string.`);
		}
	}
}

console.log(`locales checked: en, fr (${Object.keys(reference).length} runtime keys)`);
