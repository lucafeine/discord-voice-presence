# discord-voice-presence

Plugin Stream Deck **en complément du plugin Discord officiel** : affiche les
avatars des personnes présentes dans ton salon vocal sur l'**Infobar du Stream Deck Neo**.

Le plugin officiel garde ses boutons (mute, deafen, rejoindre…) ; celui-ci
occupe uniquement l'Infobar et reste purement informatif.

## Pourquoi ça marche

| Brique | Ce qu'on sait |
| --- | --- |
| Infobar du Neo | Personnalisable depuis **Stream Deck 7.6 / SDK 3.0** : layout `232 × 50 px`, items `pixmap` / `text` |
| Avatars Discord | `GET_IMAGE` du RPC local renvoie directement un `data:image/png;base64,…` |
| Participants | `GET_SELECTED_VOICE_CHANNEL` + événements `VOICE_STATE_*` / `SPEAKING_*` |
| Autorisation | Scope OAuth `rpc`, à consentir **une seule fois** |

Le tout passe par le **RPC IPC local** de Discord (`\\.\pipe\discord-ipc-0`) :
pas de bot, pas de token de compte, pas de scraping.

## Structure

```
prototype/   Phase 1 — validation de la partie Discord, hors Stream Deck
plugin/      Phase 2 — le plugin Stream Deck (SDK 3, actions Infobar)
```

Le prototype est le **banc d'essai** : il sert à valider la partie Discord
(`npm run smoke`, `status`, `watch`, `preview`) et porte les tests de
`VoiceMonitor`. Le plugin, lui, est l'artefact publié.

## Plugin

```powershell
cd plugin
npm install
npm run build          # produit <uuid>.sdPlugin/bin/plugin.js
npm run validate       # vérifie le manifeste
npm run link           # installe le plugin dans Stream Deck
npm run icons          # régénère les icônes PNG depuis les SVG
npm run watch          # build continu + redémarrage du plugin
```

Le plugin reprend les conventions des autres plugins de l'auteur
(`com.lucas.*`, SDK 3, `Software.MinimumVersion` 7.6, rollup).

⚠️ **`sharp` ne peut pas être embarqué** dans le plugin : c'est un module natif,
et Stream Deck exécute un bundle JavaScript unique. Il reste une devDependency,
réservée à la génération des icônes. Le rendu de l'Infobar doit donc se faire
avec le moteur de layouts et des assets statiques.

## Phase 1 — prototype

Voir [`prototype/README.md`](prototype/README.md).

## Contraintes connues

- Seul le salon où **tu** es connecté est visible (`GET_SELECTED_VOICE_CHANNEL`).
- L'Infobar est **en affichage seul** : aucune interaction tactile.
- Un layout est un rendu **discret** : pas de défilement fluide, seulement un
  carrousel par sauts.
- Un token OAuth expire (~7 jours) : le rafraîchissement est géré.
