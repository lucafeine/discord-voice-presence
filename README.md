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
plugin/      Phase 2 — le plugin Stream Deck (à venir)
```

## Phase 1 — prototype

Voir [`prototype/README.md`](prototype/README.md).

## Contraintes connues

- Seul le salon où **tu** es connecté est visible (`GET_SELECTED_VOICE_CHANNEL`).
- L'Infobar est **en affichage seul** : aucune interaction tactile.
- Un layout est un rendu **discret** : pas de défilement fluide, seulement un
  carrousel par sauts.
- Un token OAuth expire (~7 jours) : le rafraîchissement est géré.
