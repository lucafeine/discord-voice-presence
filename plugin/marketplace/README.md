# Marketplace submission checklist

This folder contains the product-page media and copy for **Voice Presence for
Discord**. The plugin itself is packaged from
`com.lucas.discord-voice-presence.sdPlugin`.

## Files

| File | Size | Purpose |
| --- | --- | --- |
| `app-icon-288.png` | 288 × 288 | Marketplace app icon |
| `thumbnail-1920x960.png` | 1920 × 960 | Product thumbnail |
| `gallery-0-hero-1920x960.png` | 1920 × 960 | Optional hero / first gallery item |
| `gallery-1-speaking-1920x960.png` | 1920 × 960 | Speaking ring and badges |
| `gallery-2-alerts-1920x960.png` | 1920 × 960 | Alerts and mute reminder |
| `gallery-3-setup-1920x960.png` | 1920 × 960 | Setup steps and compatibility |
| `description-en.md` | — | English product description |

Marketplace requires at least three gallery items, so upload the thumbnail plus
`gallery-1` through `gallery-3` (the hero is optional).

## Elgato guidelines covered by the project

### Plugin metadata

- **UUID**: `com.lucas.discord-voice-presence` — reverse-DNS, author and plugin
  name included. Action UUIDs are prefixed with the plugin UUID.
- **Author**: `Lucas Spitzer` — a real name, allowed by the guidelines.
- **Name**: `Voice Presence for Discord` — 28 characters, English, descriptive,
  no Maker name, no special characters, no emoji.
- **Category**: `Voice Presence for Discord` — matches the plugin name, as the
  manifest validator recommends.
- **Description**: 250+ characters, English, states the features and
  requirements.
- **Version**: `1.0.0.0`.
- **DRM readiness**: SDK 3, `@elgato/streamdeck` 3.x, Stream Deck 7.6 minimum,
  Node.js 24. The plugin does not modify its own files at runtime except for the
  theme assets, which are generated on demand (allowed: generate required files
  at runtime).

### Icons

- **Plugin icon**: PNG, 256 × 256 and 512 × 512 (`icon.png`, `icon@2x.png`).
- **Marketplace app icon**: PNG, 288 × 288.
- **Category icon**: SVG, 28 × 28 nominal, monochrome white `#FFFFFF`, fully
  transparent background.
- **Action icons**: SVG, 20 × 20 nominal, monochrome white `#FFFFFF`, fully
  transparent background.
- **Key icons**: SVG, 72 × 72 nominal.
- `npm run icons` verifies the nominal dimensions and the monochrome rule, then
  regenerates the plugin icon PNGs and the Marketplace app icon.

### Actions

- Two actions: `Voice Channel (Infobar)` and `Reconnect to Discord`; both are
  under 30 characters and have tooltips.
- The Infobar action is restricted to the Neo controller.
- Temporary feedback uses `showOk` / `showAlert` on the reconnect action.

### Layout

- The layout is `232 × 50` for the Neo Infobar. Every item stays inside the
  bounds, and no two items share the same `zOrder` while overlapping.
- `npm run assets` regenerates the layout and checks those two rules before
  writing it.

### Property Inspector

- Settings save automatically; there is no Save button.
- The color input has a label and a short description.
- Setup help is included, and the content is hidden until the UI is ready to
  avoid flicker.
- English is the default language; French is provided through the inline
  `SDPIComponents.i18n.locales` table.

### Localization

- `en.json` and `fr.json` override the manifest strings and provide runtime
  translations for the Infobar status, alerts, and mute reminders.
- English is the reference and fallback language; every other language gets
  English until a locale file is added.
- `npm run locales` checks that the manifest actions and runtime keys are
  present in both files, with no missing or extra translations.
- The Property Inspector follows the Stream Deck application language from the
  PI info payload, then `navigator.language`, then English.

### Packaging

- `.sdignore` excludes logs, source maps, and OS metadata from the
  `.streamDeckPlugin` file.
- `npm run release` builds, regenerates assets, icons and Marketplace media,
  validates the manifest, and packages the plugin.

## Before submitting

1. Fill in `SupportURL` and `URL` in `manifest.json` with the public support page
   and product page. They are optional in the schema but strongly recommended
   for Marketplace.
2. Upload `thumbnail-1920x960.png` and the three gallery PNGs in Maker Console.
3. Upload `app-icon-288.png` as the Marketplace app icon.
4. Paste `description-en.md` into the product description field.
5. Declare AI assistance in Maker Console if the submission form asks for it:
   the icon set and Marketplace visuals in this repository were produced with AI
   assistance and reviewed by the author.
6. Confirm that the plugin name and description do not imply endorsement by
   Discord. "Discord" is used only to describe compatibility.

## Commands

```powershell
cd plugin
npm run release
```

The `.streamDeckPlugin` file is written next to the `.sdPlugin` directory.
