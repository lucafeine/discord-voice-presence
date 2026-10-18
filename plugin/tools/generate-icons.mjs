import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lucas.discord-voice-presence.sdPlugin");
const source = path.join(plugin, "imgs", "plugin", "icon.svg");

for (const [name, size] of [
	["icon.png", 256],
	["icon@2x.png", 512]
]) {
	await sharp(source).resize(size, size).png().toFile(path.join(plugin, "imgs", "plugin", name));
}
