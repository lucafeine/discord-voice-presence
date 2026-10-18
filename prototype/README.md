# Prototype — validation de la partie Discord

Objectif de cette phase : vérifier **toute la partie Discord** (autorisation,
lecture du salon vocal, événements temps réel) et le **rendu de l'Infobar**
avant d'écrire la moindre ligne du plugin Stream Deck.

C'est du code Node classique, exécutable en ligne de commande. Rien n'est
installé dans Stream Deck à ce stade.

## Démarrage rapide

```powershell
cd prototype
npm install

# 1. Vérifie d'abord que le RPC Discord répond (aucune config requise)
npm run smoke

# 2. Configure l'autorisation (voir ci-dessous), puis :
npm run auth
npm run status
npm run watch
```

## Configuration

```powershell
copy .env.example .env
```

Puis, dans le portail développeur Discord :

1. <https://discord.com/developers/applications> → **New Application**
2. **General Information** → copie l'**Application ID** dans `DISCORD_CLIENT_ID`
3. **OAuth2** → copie le **Client Secret** dans `DISCORD_CLIENT_SECRET`

Aucun bot n'est nécessaire. Aucun redirect URI non plus : le transport IPC
n'envoie pas d'en-tête `Origin`, ce qui dispense de la vérification
`rpc_origins`.

> `.env` est ignoré par git. Ne committe jamais ces valeurs et ne les colle
> jamais dans une conversation.

### PKCE d'abord, secret ensuite

`DISCORD_USE_PKCE=true` (défaut) tente le flux **PKCE**, où aucun
`client_secret` n'est utilisé : intéressant pour le plugin final, puisqu'il
n'y aurait alors aucun secret à embarquer. Si Discord refuse, repasse à
`false` et l'échange se fera avec le `client_secret`.

## Commandes

| Commande | Rôle | Autorisation requise |
| --- | --- | --- |
| `npm run smoke` | Connexion au pipe, session courante, récupération de ton avatar | non |
| `npm run auth` | Consentement OAuth et stockage du token | — |
| `npm run status` | Salon vocal courant et ses participants | oui |
| `npm run watch` | Suivi temps réel des arrivées, départs et prises de parole | oui |
| `npm run preview` | Planche de rendu de l'Infobar (232 × 50) | non en `--fake` |

### Options de `preview`

| Option | Effet |
| --- | --- |
| `--fake` | Force des données synthétiques (utile avant toute autorisation) |
| `--count=N` | Nombre de participants factices (7 par défaut) |
| `--open` | Ouvre la planche dans la visionneuse par défaut |

```powershell
npm run preview -- --fake --count=7 --open   # sans Discord
npm run preview -- --live --open             # avec tes vrais avatars
```

La planche est écrite dans `out/` : une version zoomée ×3 pour juger le
design, plus chaque état à **taille réelle** (ce que l'Infobar affichera
réellement).

## Ce que le prototype a déjà confirmé

| Point | Résultat |
| --- | --- |
| Pipe `discord-ipc-0` joignable | oui |
| `READY` → utilisateur courant et hash d'avatar | oui |
| `GET_IMAGE` → data URI PNG | oui, image de 15 Ko récupérée et écrite sur disque |
| `GET_SELECTED_VOICE_CHANNEL` sans autorisation | refusé : `RPC 4006 Not authenticated or invalid scope` |
| `GET_GUILDS`, `GET_VOICE_SETTINGS` sans autorisation | refusés (`4006`) |

D'où la conclusion structurante : **les avatars sont accessibles sans rien,
mais la liste des participants exige une autorisation unique** (scope `rpc`).

## Architecture

```
src/
  config.ts    lecture de l'environnement, chemins de données
  ipc.ts       protocole binaire du RPC Discord (pipes, trames, nonces)
  auth.ts      OAuth2 : PKCE ou client_secret, refresh, persistance
  voice.ts     salon courant, souscriptions, état des participants
  avatars.ts   récupération et cache disque des avatars
  render.ts    composition de l'image 232 × 50 de l'Infobar
  fake.ts      données et avatars synthétiques
  index.ts     ligne de commande
  types.ts     types du RPC Discord
  log.ts       journalisation
```

### Décisions techniques

**Une seule image plutôt que des dizaines d'items.** Un layout d'Infobar se
compose d'items `pixmap` / `text` positionnés à la main. On préfère composer
une image unique de 232 × 50 et l'exposer via **un seul `pixmap`** couvrant
tout le layout : contrôle total du dessin (anneaux, badges, texte, arrondis)
et layout trivial.

**Pas d'animation possible.** Un layout est un rendu discret. Le « défilement »
est donc un carrousel par sauts, obtenu en poussant des images successives.

**Cache disque.** Le plugin final attend des chemins de fichiers sous son
dossier, et le cache évite de retélécharger les avatars à chaque mise à jour.
La clé inclut le hash d'avatar : changer d'avatar crée un nouveau fichier.

**Aucun appel réseau obligatoire.** `GET_IMAGE` fournit les avatars depuis le
client local ; le CDN n'est qu'un secours.

## Limites connues

- **Seul le salon où *toi* tu es connecté** est visible. Discord n'expose pas
  les autres via le RPC.
- **Quota de connexions** : 2 connexions/minute par client sur le RPC. On garde
  donc une seule connexion persistante.
- **Les souscriptions `VOICE_STATE_*` exigent un `channel_id`** : il faut donc
  d'abord lire le salon, puis souscrire, et re-souscrire à chaque changement.
- **Pas d'animation** ni d'interaction tactile sur l'Infobar.
- **Le token expire** (~7 jours) : `ensureAuthenticated` rafraîchit
  automatiquement et ne redemande le consentement qu'en dernier recours.

## Dépannage

| Symptôme | Piste |
| --- | --- |
| `Aucun pipe Discord trouvé` | Le client Discord n'est pas lancé |
| `RPC 4006` | Autorisation absente ou expirée → `npm run auth` |
| `Echange de token refusé (HTTP 400)` | PKCE refusé par l'application → `DISCORD_USE_PKCE=false` |
| Rien ne se met à jour dans `watch` | Vérifie que tu es bien connecté à un salon vocal |

Le token est stocké dans `.data/auth.json` (ignoré par git). Le supprimer force
une nouvelle autorisation.
