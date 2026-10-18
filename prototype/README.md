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
3. **OAuth2** → active **Public Client** → **Save Changes**
4. **OAuth2 → Redirects** → ajoute `http://localhost` en **première position** →
   **Save Changes**

Aucun bot, et surtout **aucun `client_secret`**.

### Pourquoi ces deux réglages sont obligatoires

Ce sont les deux pièges de cette configuration, et ils produisent des erreurs
qui ne disent pas ce qu'il faut corriger :

| Réglage manquant | Erreur obtenue |
| --- | --- |
| **Public Client** désactivé | `HTTP 401 invalid_client` à l'échange du code |
| Aucune URI dans **Redirects** | `Missing "redirect_uri" in request` |
| URI **envoyée** dans la requête | `Redirect URI cannot be used in the RPC OAuth2 Authorization flow` |
| Les deux réglages en place | ✅ |

**Public Client** autorise PKCE, donc l'absence de secret. C'est ce qui permet
de publier le plugin sans embarquer de valeur extractible.

L'URI de redirection, elle, est un contresens : le flux OAuth2 du RPC refuse
toute redirection mais exige qu'une URI soit enregistrée pour avoir une valeur
par défaut. Elle n'est jamais suivie — le code d'autorisation arrive par la
socket IPC.

> `.env` est ignoré par git. Ne committe jamais ces valeurs et ne les colle
> jamais dans une conversation.

## Commandes

| Commande | Rôle | Autorisation requise |
| --- | --- | --- |
| `npm run smoke` | Connexion au pipe, session courante, récupération de ton avatar | non |
| `npm run auth` | Consentement OAuth et stockage du token | — |
| `npm run status` | Salon vocal courant et ses participants | oui |
| `npm run watch` | Suivi temps réel des arrivées, départs et prises de parole | oui |
| `npm run preview` | Planche de rendu de l'Infobar (232 × 50) | non en `--fake` |
| `npm test` | Tests de `VoiceMonitor`, sans Discord ni réseau | non |

### Règles de comportement du suivi

Ces règles viennent d'observations réelles et sont verrouillées par `npm test` :

| Situation | Annonce |
| --- | --- |
| Quelqu'un rejoint le salon où tu es | ✅ popup « a rejoint » |
| Quelqu'un quitte le salon où tu es | ✅ popup « a quitté » |
| **Tu** changes de salon | ❌ aucune — Discord envoie des `VOICE_STATE_DELETE` pour l'ancien salon, ce ne sont pas des départs |
| **Tu** quittes le vocal | ❌ aucune — l'écran passe à « Pas en vocal », ce qui est plus juste qu'un popup |
| Quelqu'un parle / se tait | ✅ surlignage, mis à jour en direct |

La fenêtre de transition dure 1,5 s après un changement de salon. Conséquence
assumée : un départ survenant dans cet intervalle très court n'est pas annoncé,
même si l'affichage final reste correct.

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
| PKCE + Public Client | ✅ fonctionne — échange du code sans aucun `client_secret` |
| PKCE sans Public Client | ❌ `HTTP 401 invalid_client` |
| `redirect_uri` | doit être **enregistré** mais **jamais envoyé** |
| `AUTHENTICATE` après l'échange | obligatoire en PKCE ; renvoie `4002` dans l'autre flux |
| `VOICE_STATE_CREATE` / `DELETE` | reçus en direct, arrivées et départs correctement identifiés |
| `SPEAKING_START` / `STOP` | reçus en direct, malgré une documentation qui les annonce fragiles |
| `VOICE_CHANNEL_SELECT` | reçu à chaque changement de salon, avec re-souscription |
| Changement de salon | l'ancien salon émet des `DELETE` : faux départs si on ne les filtre pas |

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
  voice.test.ts tests de VoiceMonitor, avec un RPC simulé
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
| `HTTP 401 invalid_client` | **Public Client** n'est pas activé sur l'application Discord |
| `Missing "redirect_uri" in request` | Aucune URI enregistrée → OAuth2 → Redirects |
| `Redirect URI cannot be used in the RPC OAuth2 Authorization flow` | L'URI est envoyée dans la requête : elle doit seulement être enregistrée |
| `RPC is not approved` | Le scope `rpc` est restreint par Discord → onglet *App Testers* |
| Une commande reste bloquée sans rien afficher | Quota de 2 connexions/minute : attends une minute entre deux commandes |
| Rien ne se met à jour dans `watch` | Vérifie que tu es bien connecté à un salon vocal |

Le token est stocké dans `.data/auth.json` (ignoré par git). Le supprimer force
une nouvelle autorisation.
