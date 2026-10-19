# Voice Presence for Discord

A Stream Deck plugin **that complements the Discord plugin from Elgato**: it
shows the avatars of the people in your voice channel on the **Stream Deck Neo
Infobar**.

Elgato's Discord plugin keeps its buttons (mute, deafen, join...); this one only
uses the Infobar and remains purely informational.

## How it works

| Piece | What we use |
| --- | --- |
| Neo Infobar | Customizable since **Stream Deck 7.6 / SDK 3.0**: `232 × 50 px` layout with `pixmap` / `text` items |
| Discord avatars | `GET_IMAGE` from the local RPC returns a `data:image/png;base64,...` directly |
| Participants | `GET_SELECTED_VOICE_CHANNEL` plus `VOICE_STATE_*` / `SPEAKING_*` events |
| Authorization | OAuth `rpc` scope, granted **once** |

Everything goes through Discord's **local IPC RPC** (`\\.\pipe\discord-ipc-0`):
no bot, no account token, no scraping.

## Structure

```
prototype/   Phase 1 - validate the Discord side, outside Stream Deck
plugin/      Phase 2 - the Stream Deck plugin (SDK 3, Infobar actions)
```

The prototype is the **test bench**: it validates the Discord layer
(`npm run smoke`, `status`, `watch`, `preview`) and holds the `VoiceMonitor`
tests. The plugin is the published artifact.

## Plugin

```powershell
cd plugin
npm install
npm run build          # writes <uuid>.sdPlugin/bin/plugin.js
npm run assets         # regenerates the Infobar layout and assets
npm run icons          # regenerates the PNG icons and checks the SVGs
npm run locales        # checks that en.json and fr.json expose the same keys
npm run validate       # validates the manifest and layout
npm run link           # installs the plugin in Stream Deck
npm run watch          # continuous build + plugin restart
npm run release        # build + assets + icons + validation + pack
```

The plugin follows the author's other plugin conventions (`com.lucas.*`, SDK 3,
`Software.MinimumVersion` 7.6, rollup).

**`sharp` cannot be bundled** in the plugin: it is a native module, and Stream
Deck runs a single JavaScript bundle. It remains a devDependency, used only to
generate the plugin icons. The Infobar itself is rendered with the layout engine
and static assets.

## Icons

The icon set is the only visual asset kept in the repository:

| Item | Format |
| --- | --- |
| Plugin icon | PNG `256 × 256` and `512 × 512` (`icon.png`, `icon@2x.png`) |
| Category icon | SVG `28 × 28`, white `#FFFFFF`, transparent background |
| Action icons | SVG `20 × 20`, white `#FFFFFF`, transparent background |
| Key icons | SVG `72 × 72` |

`npm run icons` verifies the nominal dimensions and the monochrome rule, then
regenerates the plugin icon PNGs.

The plugin is localized in **English** and **French**: `en.json` and `fr.json`
cover the manifest, the Infobar text, and the Property Inspector. English is
the fallback for every other language, and the Property Inspector follows the
Stream Deck application language when it is available.

## Phase 1 - prototype

See [`prototype/README.md`](prototype/README.md).

## Known limitations

- Only the channel **you** are connected to is visible (`GET_SELECTED_VOICE_CHANNEL`).
- The Infobar is **display-only**: there is no touch interaction.
- A layout is a **discrete** render: no smooth scrolling, only a step carousel.
- An OAuth token expires (~7 days); refresh is handled.
