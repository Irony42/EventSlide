# Revue de code — `deuxpointzero` face à `main`

**Projet** EventSlide · **Date** 11 septembre 2026 · **Base** `main` · **Branche** `deuxpointzero` (56 commits d'avance, arbre de travail propre)

Une réécriture complète, pas une évolution : 604 fichiers, +80 675 lignes pour 2 380 supprimées. L'application Express monolithique de 1.x devient une architecture hexagonale avec frontières vérifiées mécaniquement, 3 859 tests et six niveaux de test. Le travail est d'une qualité inhabituelle. Les défauts qui restent sont concentrés sur un seul chemin : le flux temps réel du mur.

|                   |                      |
| ----------------- | -------------------- |
| Commits           | 56                   |
| Fichiers modifiés | 604                  |
| Tests             | 3 859 / 177 fichiers |
| Échecs            | 0 (en 10,8 s)        |
| Constats          | 18                   |
| Dont élevés       | 4                    |

---

## 1. Verdict

> **Fusionnable après correction de F1 et F4.** F1 est un déni de service non authentifié qui coupe le mur en silence ; F4 est une fonctionnalité livrée qui ne fonctionne dans aucun cas. Les seize autres constats sont du travail de suivi légitime.

Cette branche est meilleure que la plupart du code de production que l'on croise. Ce n'est pas une formule de politesse : c'est ce que montrent les vérifications mécaniques de la section 2.

La discipline architecturale n'est pas déclarative. J'ai injecté un fichier volontairement fautif dans `src/domain/` qui importait `node:crypto`, `fs` et la couche application : ESLint a rejeté les trois, y compris l'import relatif `../application/ports/clock`. La règle la plus importante du dépôt tient réellement au build.

Le point remarquable, et rare, est `docs/API.md` §9 : la documentation recense elle-même dix divergences entre le contrat et le code, dont cinq qualifiées de _code defect_, avec fichier et numéro de ligne. J'en ai vérifié quatre : toutes exactes, toutes encore présentes. C'est une honnêteté qui mérite d'être dite — et qui ne dispense pas de les corriger, parce qu'un défaut documenté reste un défaut en production.

La concentration des problèmes est en revanche frappante. Sur dix-huit constats, quatre portent sur le même chemin : le flux SSE qui alimente le mur projeté. C'est aussi la promesse centrale du produit. Le reste du code — upload, authentification, persistance, isolation entre événements — résiste à un examen soutenu.

---

## 2. Ce qui a été vérifié, pas cru sur parole

Les documents de ce dépôt affirment beaucoup de choses. Chaque affirmation forte a été confrontée au code ou exécutée.

| Affirmation                                                | Source                            | Méthode                                                     | Résultat                                                               |
| ---------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Les frontières hexagonales sont vérifiées mécaniquement    | `CLAUDE.md` §2                    | Fichier fautif injecté dans `src/domain/`, `npx eslint`     | **Exact** — 3 violations sur 3 rejetées                                |
| La suite est verte                                         | mémoire projet                    | `npm run test:run`                                          | **Exact** — 3 859 / 3 859 en 10,8 s                                    |
| Aucune interpolation dans le SQL                           | implicite                         | grep sur ``prepare(`…${…}`)`` dans `src/infrastructure/db/` | **Exact** — un seul cas, dans un test, colonnes en dur                 |
| Aucun `dangerouslySetInnerHTML`                            | `SECURITY.md` §12                 | grep sur `web/src/`                                         | **Exact** — zéro occurrence, y compris `innerHTML` et `eval`           |
| Chaque route documentée existe, et réciproquement          | `API.md` §9                       | Inventaire des `router.*` comparé aux en-têtes d'API.md     | **Presque** — `DELETE /events/:slug` n'a qu'une ligne de tableau (F10) |
| Les suites de contrat tournent sur le fake _et_ sur SQLite | `TESTING.md`                      | grep des appelants de `*RepositoryContract`                 | **Exact** — 6 ports × 2 implémentations                                |
| Régénération de session à la connexion                     | `CLAUDE.md` §8                    | Lecture de `authRoutes.ts`                                  | **Exact** — `regenerate` + `destroy` + `clearCookie`                   |
| Les sept _skills_ annoncées aux agents existent            | `AGENTS.md`                       | `ls .claude/skills/`                                        | **Exact** — 7 / 7                                                      |
| Le plafond d'abonnés SSE fait répondre 503                 | commentaire de `inMemoryEventBus` | Lecture de `inMemoryEventBus.ts` + `streamRoutes.ts`        | **Faux** — échec silencieux (F1)                                       |
| Les snapshots visuels protègent le mur                     | 3 commits dédiés                  | Lecture de `ci.yml` et des scripts npm                      | **Faux** — jamais exécutés en CI (F6)                                  |

---

## 3. Les 18 constats

> **Lignes de statut, ajoutées le 11 septembre 2026.** Les constats corrigés depuis la
> revue portent une ligne **Statut** sous leur titre, avec le fichier ou le test qui le
> prouve. Un constat sans ligne de statut est **ouvert** : il n'a pas été traité, ou il
> l'a été sans que je le vérifie — et dans ce dépôt une correction non vérifiée se lit
> comme une correction absente. Chaque ligne présente ici a été confrontée au code, pas
> déduite d'un message de commit. La suite passe à 3 938 tests au moment où elles sont
> écrites.

Classés par gravité. Aucun n'est critique au sens « exploitable pour lire les photos d'autrui » : l'isolation entre événements résiste. Les quatre constats élevés sont des pannes de disponibilité ou de fonctionnalité.

### Gravité élevée

#### F1 — Le plafond d'abonnés SSE échoue en silence : 200 connexions anonymes figent le mur d'un événement

> **Statut — corrigé.** La cause racine a été traitée par le type : `EventBus.subscribe`
> est désormais faillible et documenté comme tel (`src/application/ports/eventBus.ts`,
> « **Fallible on purpose** »), et `openStream` s'abonne **avant** d'écrire le moindre
> en-tête puis répond `503` sur échec (`streamRoutes.ts:193`, `:296`). Test :
> `streamRoutes.test.ts:333`, « refuses a connection the bus has no room for, with 503
> and no stream ».

`src/infrastructure/realtime/inMemoryEventBus.ts:70` · `src/interface/http/routes/streamRoutes.ts:148`

Au-delà de `maxSubscribersPerEvent` (200 par défaut), `subscribe()` journalise un avertissement et retourne une fonction de désabonnement vide — un `Unsubscribe` indistinguable d'un vrai. Le commentaire annonce que « la couche HTTP décide de répondre 503 » ; `openStream` utilise la valeur retournée uniquement comme fonction de nettoyage et ne décide rien.

Ce que reçoit un projecteur au-delà du plafond : `200`, les en-têtes, `: connected`, puis un _heartbeat_ toutes les quinze secondes — et jamais la moindre trame `change`, pour le reste de la soirée. Côté client, `useEventStream` lève `open` et expose `connected: true`. Le mur cesse de se mettre à jour en affichant « connecté ».

Le canal public `GET /api/events/:slug/stream` ne demande aucune authentification. Un attaquant qui connaît le _slug_ — que SECURITY.md §12 admet comme divulgable, « le mur sert d'invitation » — ouvre 200 `EventSource` et éteint définitivement la promesse centrale du produit, sans qu'aucun écran n'affiche d'erreur.

La cause racine est architecturale, et la documentation ne la nomme pas : le type `Unsubscribe` du port `EventBus` n'a pas de canal d'échec. « La couche HTTP décide » est _inexprimable_ avec cette signature. Le reste du code utilise partout `Result<T, DomainError>` ; ce port est l'exception, et c'est exactement là que le défaut est né.

**Correctif.** Faire retourner à `subscribe` un `Result<Unsubscribe, DomainError>` comme le reste des ports. `openStream` répond alors `503 service.notReady` _avant_ d'écrire le moindre en-tête. Ajouter côté client un chien de garde : aucune trame ni commentaire reçu depuis 45 s ⇒ fermer et reconnecter. Les deux sont nécessaires : le premier corrige la cause, le second couvre la même panne quand elle vient d'un proxy.

#### F2 — Aucune limite de débit ni de connexions sur le flux SSE public

> **Statut — corrigé.** `streamConnectionLimiter` borne les connexions _simultanées_ par
> clé client — et non les requêtes par minute, ce qui était la distinction à faire —
> avec `MAX_STREAMS_PER_CLIENT = 12` et son raisonnement écrit
> (`src/interface/http/middleware/rateLimit.ts`). Monté sur les deux routes de flux
> (`streamRoutes.ts:309`). Tests dans `rateLimit.test.ts`.

`src/interface/http/routes/streamRoutes.ts:216` · `src/interface/http/server.ts:117`

`joinLimiter`, `loginLimiter`, `uploadLimiter` et `reactionLimiter` couvrent toutes les écritures publiques. La route de flux, elle, n'a aucun limiteur — alors que c'est la seule route qui immobilise une ressource dans la durée : une socket, un `setInterval` et une entrée dans le `Set` du bus, pour des heures.

`server.maxConnections` n'est pas fixé non plus, et `requestTimeout = 0` est mis délibérément à zéro pour le SSE. C'est ce qui rend F1 trivial à déclencher, et c'est aussi un épuisement de descripteurs de fichiers dans l'absolu.

**Correctif.** Un limiteur de _connexions simultanées_ par clé IP (et non de requêtes par minute) sur les deux routes de flux, plus un plafond global de connexions par processus. Le plafond existant du bus reste la deuxième ligne de défense — mais il doit devenir bruyant, cf. F1.

#### F3 — Les uploads sont tamponnés en mémoire sans borne agrégée : 500 Mo par requête pour 1 Go de limite conteneur

`src/interface/http/routes/guestRoutes.ts:172` · `src/infrastructure/config/env.ts:77` · `compose.yaml:52`

`multer.memoryStorage()` avec `limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_UPLOAD }`. Multer borne _par fichier_ et _en nombre_, jamais au total : aux valeurs par défaut, 20 × 25 Mo = 500 Mo de `Buffer` pour une seule requête. `compose.yaml` fixe `memory: 1g`.

S'y ajoute `sharp`, qui décode ensuite chaque image en trois variantes. Le choix de la mémoire plutôt que du disque est justifié dans le code (le pipeline ré-encode tout, 1.0 fuyait sur le nettoyage des fichiers temporaires) — mais la conséquence n'est bornée nulle part, et le limiteur d'upload plafonne le débit, pas la concurrence.

**Correctif.** Ajouter une borne agrégée sur la requête : soit un plafond explicite `MAX_UPLOAD_BYTES_PER_REQUEST` vérifié pendant la lecture du flux, soit aligner le produit `maxBytes × maxFiles` sur la limite mémoire du conteneur et documenter le lien dans `.env.example`. Un test de la borne au ring 4 tient les deux valeurs ensemble.

#### F4 — L'invitation d'un modérateur est refusée dans 100 % des cas

> **Statut — corrigé.** Le panneau porte le champ de mot de passe temporaire
> (`ModeratorsPanel.tsx:178`), `InviteModeratorBody` l'exige côté client
> (`client.ts:63`), et c'est bien le contrat serveur qui a été rejoint. Test :
> `ModeratorsPanel.test.tsx:126`, dont le commentaire nomme la cause — le schéma est
> `.strict()` et `temporaryPassword` n'est pas optionnel.

`web/src/lib/api/client.ts:190` · `src/interface/http/schemas/requestSchemas.ts:245`

Le client envoie `{ email }`. Le schéma serveur `moderatorInvitationBody` est `.strict()` et exige `temporaryPassword`. Toute invitation émise depuis `ModeratorsPanel.tsx` reçoit `400 request.invalid`. Le client type par ailleurs la réponse en `ModeratorDto` quand le serveur répond `{ userId, created }` en 201.

Le contrat serveur est le bon — il n'y a pas de service d'envoi d'e-mail, donc l'hôte doit transmettre un identifiant de vive voix. C'est le panneau d'administration qui est incomplet : il lui manque le champ. Identifié en API.md §9.2 et non corrigé.

Aucun test ne l'a attrapé parce que les deux côtés sont testés séparément et correctement : le test HTTP envoie le corps complet, le test React vérifie que le client appelle bien `api.inviteModerator`. C'est la limite exacte du découpage en anneaux — et la raison pour laquelle ce parcours mérite un test e2e.

**Correctif.** Ajouter le champ mot de passe temporaire au panneau, le faire transiter par `useInviteModerator` et `api.inviteModerator`, corriger le type de retour, et ajouter un parcours e2e « l'hôte invite un modérateur qui se connecte ensuite ».

### Gravité moyenne

#### F5 — La console de modération s'abonne au canal public ; le canal autorisé est du code mort

> **Statut — corrigé.** `api.moderationStreamUrl` existe et c'est lui que la console
> appelle (`useModerationQueue.ts:402`). Assertions aux deux bouts :
> `useModerationQueue.test.tsx:105` côté client, et au ring 4 « refuses the moderation
> channel without a session » attend bien un `401` (`streamRoutes.test.ts:327`).

`web/src/features/moderation/hooks/useModerationQueue.ts:392` · `web/src/lib/api/client.ts:200`

`api.streamUrl(slug)` construit `/api/events/:slug/stream`, le canal du mur. `GET /api/events/:slug/moderation/stream` est implémenté, protégé par `requireRole('moderator')`, testé — et appelé par personne : aucune méthode `moderationStreamUrl` n'existe dans le client.

Les trames étant identiques, rien ne casse visiblement. Mais la console tient une connexion non authentifiée vers un point d'entrée dont l'existence même de la version autorisée est la justification. Et l'écart se paiera le jour où les deux canaux divergeront — par exemple si la modération doit voir les photos rejetées.

**Correctif.** Ajouter `moderationStreamUrl` au client, l'utiliser dans `useModerationQueue`, et ajouter au ring 4 une assertion que ce chemin répond 401 sans session.

#### F6 — Les tests de régression visuelle ne sont exécutés par aucun job CI

> **Statut — corrigé, mais pas comme le suggérait le correctif.** Un job `visual` a été
> ajouté (`.github/workflows/ci.yml`) et il ne compare **jamais** les images commises :
> celles-ci ont été produites sur un poste Windows, un runner Ubuntu ne les reproduira
> pas, et c'est précisément la raison pour laquelle elles avaient été sorties de la CI
> (commit `4748a55`). Un job rouge en permanence aurait réintroduit le défaut sous une
> autre forme. Le job rend donc lui-même son « avant » depuis la base de fusion de la
> _pull request_, sur le runner, dans la même exécution, puis rend l'« après » et compare
> les deux : un seul Chromium, une seule pile de polices, une seule machine, donc un
> écart ne peut signifier qu'une chose — cette PR a changé l'aspect du mur. Le job
> n'existe pas sur un simple `push`, faute d'un « avant » : absent plutôt que cassé.
> Vérifié en rejouant la séquence dans un clone : `--wall-safe` porté de 4 % à 11 %
> (le mur se décale visiblement) laisse `npm run test:e2e` **vert** — 44 passés — et fait
> échouer la comparaison avec un écart de 2 % des pixels. Les images commises gardent
> leur rôle : la boucle locale, `npm run test:e2e:visual`.

`.github/workflows/ci.yml:85` · `package.json` (scripts `test:e2e`, `test:e2e:visual`)

La CI lance `npm run test:e2e`, défini comme `playwright test --grep-invert @visual`. Aucun job ne lance `test:e2e:visual`. Les quatre snapshots de `tests/e2e/__screenshots__/chromium-desktop/` ne sont jamais comparés.

Ce qui rend le constat concret : cette branche contient _trois_ commits qui corrigent des snapshots photographiant la mauvaise chose (`e03dc35`, `2019f3d`, `509f016`). Ces défauts ont été trouvés à la main. Rien n'empêche la même classe d'erreur de revenir.

**Correctif.** Ajouter un job `visual` exécutant `test:e2e:visual` sur `chromium-desktop`, ou l'admettre explicitement en supprimant les snapshots. Un garde-fou qui ne s'exécute pas est pire qu'absent : il donne l'impression d'une couverture.

#### F7 — Le projet Playwright `firefox-desktop` n'est dans aucune matrice CI

> **Statut — corrigé.** `firefox-desktop` est ajouté à la matrice du job `e2e`
> (`.github/workflows/ci.yml`). Le projet reste filtré sur `@smoke` dans
> `playwright.config.ts`, donc il exécute quatre spécifications et non la suite entière :
> la promesse « confiance inter-navigateurs sans tripler chaque exécution » est
> maintenant tenue au lieu d'être seulement écrite.

`playwright.config.ts:58` · `.github/workflows/ci.yml:67`

Le projet existe, filtré sur `@smoke`, avec le commentaire « confiance inter-navigateurs sans tripler chaque exécution ». La matrice CI liste `chromium-desktop`, `chromium-mobile`, `webkit-mobile`. Firefox n'est jamais exécuté : la confiance annoncée n'existe pas.

**Correctif.** Ajouter `firefox-desktop` à la matrice — il ne lance que les `@smoke`, le coût est faible — ou retirer le projet de la configuration.

#### F8 — Le quota d'événement est franchissable par des uploads concurrents (TOCTOU)

`src/application/usecases/photos/uploadPhotos.ts:174, 186, 263`

`photos.countByAuthor()` et `photos.totalBytes()` sont lus une fois, avant la boucle. `addedBytes` accumule correctement _à l'intérieur_ d'une requête — le commentaire le souligne — mais rien ne coordonne deux requêtes simultanées. Deux invités qui envoient en même temps lisent le même `usedBytes` et passent chacun le contrôle : le quota est dépassable d'un facteur égal au nombre de requêtes en vol.

Impact réel modéré — le quota par défaut est de 5 Go et le dépassement se chiffre en dizaines de mégaoctets — mais il est présenté comme le contrôle qui empêche de remplir le disque, et la même race s'applique à `maxPhotosPerGuest`.

**Correctif.** Déplacer la réservation d'octets dans la transaction d'écriture : un `UPDATE events SET used_bytes = used_bytes + ? WHERE id = ? AND used_bytes + ? <= quota` qui échoue sur zéro ligne affectée. SQLite en WAL sérialise les écritures, donc le contrôle devient exact sans verrou applicatif.

#### F9 — Le jeton CSRF n'est ni lié à la session ni renouvelé lors du changement de privilège

`src/interface/http/middleware/csrf.ts:40` · `src/interface/http/routes/authRoutes.ts:103`

`issueCsrfToken` ne pose le cookie que s'il est absent. La session, elle, est correctement régénérée à la connexion et détruite à la déconnexion. Le jeton CSRF survit donc à la connexion, à la déconnexion et au changement d'identité : le même `es_csrf` couvre le visiteur anonyme, l'invité et l'hôte connecté.

Le choix du _double-submit_ non signé est justifié dans le code — les invités n'ont pas de session, et c'est l'upload invité qui a le plus besoin de la protection. C'est défendable. Mais le motif ne résiste pas à une injection de cookie : tout ce qui peut écrire un cookie sur l'origine (sous-domaine compromis, MITM sur un déploiement HTTP interne) peut forger la paire cookie/en-tête.

**Correctif.** Renouveler le jeton dans le même geste que `session.regenerate()` et que `session.destroy()`. Pour le fond : signer le jeton avec `SESSION_SECRET` (HMAC sur une valeur aléatoire) rend l'injection de cookie insuffisante tout en restant sans état pour les invités — c'est le motif _signed double-submit_, et il coûte dix lignes ici.

#### F10 — La suppression définitive d'un événement n'a pas de section de contrat

`src/interface/http/routes/eventRoutes.ts:266` · `docs/API.md:646`

`DELETE /api/events/:slug` purge l'événement, ses photos et ses médias, sans retour arrière. API.md lui consacre une ligne de tableau (« Purge: media first, then rows ») et aucune section `###`, alors que les trente-huit autres points d'entrée en ont une avec corps de requête, codes de retour et erreurs.

C'est le seul endpoint irréversible du produit, et celui dont un agent IA ou un intégrateur a le plus besoin de connaître le contrat exact. CLAUDE.md §10 désigne API.md comme « le contrat » ; ici il ne l'est pas.

**Correctif.** Écrire la section : prérequis de rôle, codes 204/404/409, ce qui est détruit, ce qui subsiste, et le comportement sur un événement déjà purgé.

#### F11 — Le journal de relecture SSE attribue un identifiant différent par client au même événement

> **Statut — corrigé.** Le numéro vient désormais du bus : `channel.log.record(delivery.sequence, …)`
> (`streamRoutes.ts:190`), donc un événement de domaine produit une entrée et une seule,
> diffusée identique à tous les abonnés. Test : « gives two clients of one event the same
> id for one change » (`streamRoutes.test.ts:200`).

`src/interface/http/routes/streamRoutes.ts:150`

`writeSignal(res, log.append(domainEvent.type))` est exécuté _dans le callback de chaque abonné_. Un seul événement de domaine produit donc N entrées d'identifiants distincts pour N clients connectés, et chaque client ne voit que le sien.

Deux conséquences. L'espace d'identifiants `Last-Event-ID` n'est pas partagé : à la reconnexion, un client rejoue des entrées qui sont des doublons du même changement. Et le tampon circulaire de 64 est consommé N fois plus vite : avec un projecteur, deux consoles et trois téléphones, la fenêtre de relecture réelle tombe à une dizaine de signaux.

Bénin aujourd'hui, parce que la trame est un signal d'invalidation sans données et que le client refait un _fetch_ complet à chaque reconnexion — la documentation le dit explicitement. Mais la structure ne fait pas ce que son nom promet, et l'ambiguïté coûtera cher si la relecture devient un jour porteuse d'état.

**Correctif.** Faire publier au bus un signal déjà numéroté : `append` une fois par événement de domaine, dans `publish` ou dans un abonné unique par événement, et diffuser la même instance de `Signal` à tous les abonnés.

### Gravité faible

#### F12 — `compose.yaml` provisionne un tmpfs pour un multer qui n'écrit jamais sur disque

> **Statut — corrigé.** Le commentaire dit maintenant ce qui est vrai : rien n'est
> tamponné là, `multer.memoryStorage()` garde chaque octet dans le tas, et le nombre à
> dimensionner pour les uploads est `deploy.resources.limits.memory` — avec le produit
> `MAX_FILES_PER_UPLOAD × MAX_UPLOAD_BYTES` (20 × 25 Mo par défaut, vérifié dans
> `env.ts:112`) écrit en face, ce qui relie enfin F12 à F3. Le montage est **conservé** :
> `read_only: true` rend toute la racine non inscriptible, et un processus Node sans
> répertoire temporaire échoue de façon illisible. Ce qui écrit réellement dans `/tmp`
> dans ce dépôt est `scripts/seedDemo.ts:68` (`mkdtemp`), et `tsconfig.build.json`
> n'embarque que `src/**` dans l'image, donc pas lui.

`compose.yaml:40` · `src/interface/http/routes/guestRoutes.ts:173`

Le commentaire dit « multer stages an upload here before the pipeline re-encodes it » et réserve `/tmp:size=512m`. Le code utilise `multer.memoryStorage()` : rien n'est jamais écrit là. Un opérateur qui dimensionne sa machine d'après ce commentaire se trompe de ressource — et c'est justement celle qui manque, cf. F3.

**Correctif.** Corriger le commentaire pour dire que les uploads sont tamponnés en mémoire et que c'est `deploy.resources.limits.memory` qu'il faut dimensionner.

#### F13 — Aucun fichier LICENSE alors que `package.json` déclare GPL-3.0

`package.json:9` · racine du dépôt

Déjà relevé par le commit `6a0cf58` (« flag the missing licence ») et par `6be8a2f`, qui a retiré du README le lien qui la promettait. Le fichier n'a toujours pas été ajouté. Pour un produit auto-hébergé dont l'argument est que l'opérateur possède ses données, la licence n'est pas un détail administratif.

**Correctif.** Ajouter le texte GPL-3.0 en `LICENSE` et rétablir le lien dans le README.

#### F14 — `scripts/` est hors couverture et hors seuils

> **Statut — à moitié corrigé, et la moitié qui manque est nommée ici.** `scripts/**/*.ts`
> entre dans `coverage.include`, et `scripts/**/*.test.ts` entre dans la collecte du
> projet `server` — sans quoi un test écrit à côté d'un outil n'aurait jamais été
> exécuté, exactement le défaut de F6 sous une autre forme. Le seuil est en place mais
> c'est un **cliquet, pas un plancher** : les cinq scripts sont à 0 %, donc le seul
> plancher en pourcentage qui passe est 0, et un seuil qui ne peut pas échouer ne vaut
> pas mieux que pas de seuil. Les valeurs sont donc négatives — le nombre maximal
> d'entités _non couvertes_ — épinglées sur la dette du jour (350 instructions).
> Vérifié dans les deux sens : vert tel quel, et rouge à `-349` avec le message
> « Uncovered statements (350) exceed "scripts/\*\*" threshold (349) ».
>
> **Reste à faire, et c'est un travail de test, pas de configuration.** Le fond est déjà
> couvert ailleurs — `backupArchive.ts` est sous le seuil `src/infrastructure/**` — donc
> ce qui manque est la coquille CLI, et c'est elle qu'un opérateur manipule à une heure
> du matin : l'analyse des arguments, le code de sortie et ce qui est imprimé. Cinq
> tests, un par outil : le seeder refuse une base de production (`seedDemo.ts`, garde
> `config.isProduction`) ; `migrate.ts --status` rend compte des migrations en attente
> sans en appliquer une seule ; `purge.ts --dry-run` ne touche ni fichier ni ligne ;
> `backup.ts --verify` sort non nul sur une archive abîmée ; `restore.ts` refuse une
> cible non vide sans `--force`, et imprime ce qu'il allait détruire. Chaque test écrit
> fait baisser un des quatre nombres du cliquet.

`vitest.config.ts:43`

`coverage.include` ne couvre que `src/**` et `web/src/**`. `scripts/migrate.ts` et `scripts/seedDemo.ts` n'ont ni test ni seuil — alors que `migrate.ts` est l'outil qu'un opérateur lance sur une base qui contient les photos d'un mariage.

À noter : `seedDemo.ts` refuse correctement de s'exécuter quand `config.isProduction`, et son mot de passe de démonstration est explicitement nommé `demo-passphrase-not-for-production`. Le garde-fou existe ; c'est sa vérification automatique qui manque.

**Correctif.** Étendre `coverage.include` à `scripts/**` avec un seuil modeste, et ajouter un test qui assure que le seeder refuse une base de production.

#### F15 — `package.json` sans `"type": "module"` : avertissement Node à chaque lint

`package.json` · `eslint.config.js`

Node émet `MODULE_TYPELESS_PACKAGE_JSON` et reparse `eslint.config.js` en ESM à chaque exécution. Bruit dans les journaux CI, et surcoût à chaque `npm run lint` — soit à chaque itération d'un agent.

**Correctif.** Ajouter `"type": "module"`, ou renommer le fichier en `eslint.config.mjs`.

#### F16 — `BOOTSTRAP_OWNER_PASSWORD` n'a aucune longueur minimale

`src/infrastructure/config/env.ts:105`

`z.string().optional()`, sans contrainte, pour la variable qui crée le premier compte propriétaire d'une instance. Le reste du fichier est exemplaire : les secrets exigent 32 caractères, refusent les valeurs de `.env.example`, et `BCRYPT_COST` est borné aux deux extrémités avec une explication de pourquoi le plancher existe.

La politique de mot de passe appartient au domaine (`Password`), et `bootstrapOwner` la fait probablement respecter — mais l'échec survient alors pendant l'assemblage du conteneur, exactement le scénario que le commentaire sur `BCRYPT_COST` décrit comme la raison de valider ici.

**Correctif.** Appliquer la même logique qu'à `BCRYPT_COST` : une longueur minimale ici, pour que l'échec soit une `ConfigError` nommant la variable.

#### F17 — Les clés de limitation de débit sont construites sur un _slug_ non validé

`src/interface/http/middleware/rateLimit.ts:69, 77`

`` `${clientKey(req)}:${req.params['eventSlug'] ?? 'none'}` ``. Le limiteur est monté _avant_ `requireGuest` — délibérément, pour rejeter un flot avant qu'il ne coûte une vérification de jeton — donc le _slug_ n'a encore été validé par rien. La cardinalité des clés dans le store mémoire est dictée par l'attaquant.

Borné en pratique : le `MemoryStore` d'express-rate-limit réinitialise à chaque fenêtre d'une minute, donc la croissance ne dépasse pas une minute de trafic. Réel néanmoins comme facteur d'amplification mémoire.

**Correctif.** Tronquer ou hacher le segment de _slug_ dans la clé, ou le valider avec `Slug.create` et retomber sur `'none'` en cas d'échec.

#### F18 — La `Map` des journaux de signaux n'est jamais purgée

> **Statut — corrigé.** La `Map` est devenue une `Map<EventId, Channel>` où `Channel`
> compte ses connexions : `acquireChannel` incrémente, `releaseChannel` décrémente et
> supprime l'entrée quand le dernier abonné se retire (`streamRoutes.ts:126–142`). Un
> événement purgé ne laisse donc plus rien derrière lui.

`src/interface/http/routes/streamRoutes.ts:83`

`const logs = new Map<EventId, SignalLog>()` au niveau du module, tenue pour la durée de vie du processus. Le commentaire la déclare bornée par le nombre d'événements servis, ce qui est vrai — mais un événement purgé y laisse son tampon pour toujours, et l'état vit hors du conteneur d'injection de dépendances, ce qui est la seule entorse au principe de composition dans tout ce code.

**Correctif.** Supprimer l'entrée quand le dernier abonné d'un événement se retire — le bus sait déjà le détecter — ou déplacer les journaux dans le conteneur, aux côtés du bus.

---

## 4. Sécurité

> Le modèle de menace est réel et les contrôles tiennent. Ce qui manque n'est pas la confidentialité, c'est la disponibilité.

L'isolation entre événements — l'invariant que le produit ne peut pas se permettre de rater — est structurelle plutôt que déclarative. Le jeton invité HMAC nomme un événement, et `requireGuest` compare cet identifiant à celui résolu depuis l'URL ; le dépôt de photos n'expose pas de `findById(photoId)`, seulement des méthodes portées par `(eventId, …)`, donc une photo d'un autre événement n'est pas interdite, elle est _absente_. Trois spécifications e2e l'assertent contre un vrai serveur, avec de vrais cookies.

Le pipeline d'upload est le meilleur morceau de la branche. Identification par octets magiques en liste blanche, refus explicite des SVG, PHP, ELF et exécutables Windows avec normalisation du BOM et de l'espace de tête ; `probe` avant tout décodage pour rejeter une bombe de décompression depuis son en-tête ; ré-encodage systématique de _toutes_ les variantes, y compris l'originale, de sorte qu'un fichier polyglotte ne survit pas et qu'aucune coordonnée GPS ne subsiste ; écriture des médias avant l'insertion des lignes, avec nettoyage sur chaque chemin de sortie. Chaque décision d'ordonnancement est justifiée par un défaut concret de 1.0.

Les octets sont servis par un contrôleur, jamais par `express.static`, avec une règle appliquée partout : tout refus qui confirmerait l'existence d'une photo ou d'un événement répond **404, jamais 403**. Le raffinement va jusqu'à `requireRole`, qui renvoie 401 avant de chercher l'événement pour qu'une requête anonyme ne serve pas à découvrir les _slugs_ présents sur la machine.

La CSP est stricte et le mérite : `'self'` partout, pas de CDN, `frame-ancestors 'none'`, `connect-src 'self'`. Le seul `'unsafe-inline'` résiduel est sur `style-src`, avec sa raison (attributs de style calculés pour la durée du Ken Burns) et la contrepartie : aucun `dangerouslySetInnerHTML` nulle part, vérifié.

Ce que le modèle de menace ne couvre pas : le tableau des risques acceptés de SECURITY.md §12 énumère sept entrées et aucune ne concerne l'épuisement de ressources. F1, F2 et F3 tombent tous les trois dans cet angle mort. Pour un produit dont la promesse est « tourne sans surveillance pendant huit heures sur un vidéoprojecteur », la disponibilité _est_ une propriété de sécurité.

| Contrôle                                      | État          | Note                                                                                                               |
| --------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Isolation entre événements                    | **Solide**    | Structurelle : pas de lecture possible hors `eventId`. Testée aux rings 4 et 6.                                    |
| Durcissement des uploads                      | **Solide**    | Octets magiques, budget de pixels avant décodage, ré-encodage total, EXIF supprimé.                                |
| Jeton invité                                  | **Solide**    | HMAC-SHA256, secret ≥ 32 caractères imposé, comparaison à temps constant, MAC vérifié avant le parseur JSON.       |
| Authentification hôte                         | **Solide**    | bcrypt coût 10–15 imposé, session régénérée, store SQLite, rôle vérifié par événement.                             |
| Injection SQL                                 | **Solide**    | Paramètres liés partout. `foreign_keys`, WAL et `busy_timeout` actifs.                                             |
| XSS                                           | **Solide**    | CSP stricte, `nosniff` sur les médias, React échappe, aucune insertion HTML brute.                                 |
| CSRF                                          | **Correct**   | Double-submit, comparaison à temps constant, monté avant toutes les routes. Jeton non signé et non renouvelé (F9). |
| Limitation de débit                           | **Partiel**   | Bonne couverture des écritures, clé IPv6 correcte. Flux SSE non couvert (F2), état en mémoire (risque accepté).    |
| Épuisement de ressources                      | **Découvert** | Connexions SSE (F1, F2), mémoire d'upload (F3). Absent du tableau des risques acceptés.                            |
| Refus de démarrage sur mauvaise configuration | **Solide**    | Secrets exigés en production, valeurs d'exemple refusées, `E2E_HOOKS` interdit, HTTPS imposé.                      |

---

## 5. Architecture

> L'architecture hexagonale est réellement appliquée, et c'est la différence entre cette branche et la plupart des dépôts qui affichent le même diagramme.

La vérification vaut mieux qu'une lecture : j'ai déposé dans `src/domain/` un fichier important `node:crypto`, `fs` et `../application/ports/clock`. ESLint a rejeté les trois avec des messages qui expliquent quoi faire à la place (« modélisez le besoin comme un port »). La règle survivra donc aux relectures distraites — et aux agents.

Le découpage est cohérent jusque dans les détails. Le domaine est pur et l'interdiction de `Date.now()`, `new Date()` et `Math.random()` y est imposée par sélecteur AST, pas par convention. `server.ts` n'appelle jamais `listen()`, ce qui rend toute la surface HTTP testable sans ouvrir de port — et le commentaire explique que c'est précisément ce qui manquait à 1.0. `process.env` n'est lisible que dans `env.ts`, imposé lui aussi par règle.

Deux choix méritent d'être signalés comme excellents. Les _ports_ sont exposés aux routes par des `Pick<HttpUseCases, …>` module par module : `mediaRoutes` déclare avoir besoin de deux cas d'usage, pas de trente, ce qui rend ses tests proportionnés à ce qu'il fait. Et les doublures de test sont des _fakes_ de qualité production partageant une suite de contrat exécutée à la fois contre le fake et contre l'adaptateur SQLite — six ports, deux implémentations chacun. C'est la seule technique qui empêche vraiment une doublure de mentir.

### Les deux entorses

La première est le port `EventBus`, dont `Unsubscribe` n'a pas de canal d'échec alors que tout le reste du code utilise `Result<T, DomainError>`. C'est la cause racine de F1 : l'intention documentée (« la couche HTTP décide de répondre 503 ») n'est pas exprimable avec cette signature. Quand un type ne peut pas porter une intention, l'intention disparaît sans que personne s'en aperçoive.

La seconde est `const logs = new Map()` au niveau du module dans `streamRoutes.ts` (F18). C'est le seul état mutable qui échappe au conteneur de composition, et il n'y a pas de raison qu'il y échappe.

### Exploitation

L'image Docker est bien faite : multi-étages, `USER node`, `dumb-init` pour que SIGTERM atteigne le processus, `HEALTHCHECK` branché sur la vraie sonde de disponibilité plutôt que sur l'ouverture du port. Le `compose.yaml` ajoute `read_only`, `cap_drop: ALL` et `no-new-privileges`. Les migrations tournent dans `createContainer` avant l'ouverture du port, donc un conteneur neuf s'initialise correctement même si `tsx` a été élagué de l'image.

L'arrêt gracieux est traité sérieusement — fermeture du serveur, puis `container.dispose()`, avec un délai de grâce de 15 s parce qu'un flux SSE ne se fermera jamais de lui-même, et un second signal qui sort immédiatement. Le commentaire explique que 1.0 enregistrait un `db.close()` asynchrone sur `process.on('exit')` qui ne se terminait jamais, d'où des WAL non fusionnés.

**Sur la parité fonctionnelle**, un point à trancher explicitement : il n'existe aucune migration des données depuis le schéma 1.x. La branche est un départ à blanc. C'est probablement le bon choix pour un produit où les données sont des événements passés, mais ce n'est écrit nulle part, et un opérateur qui met à jour le découvrira en démarrant.

---

## 6. Qualité des tests

> 3 859 tests en 10,8 secondes, et ils testent du comportement, pas des appels de mocks. C'est la partie la plus solide de la branche après le pipeline d'upload.

J'ai cherché les pathologies habituelles. Pas de `vi.mock` de module interne — la stratégie est explicitement « des fakes, pas des mocks », et les fakes sont de vraies implémentations en mémoire, testées elles-mêmes. Pas d'assertion sur des helpers privés. Pas de `waitForTimeout` dans le e2e : c'est interdit par un sélecteur ESLint dédié, avec le motif (« la première source de flakiness dans une application pilotée par SSE »).

Les spécifications de sécurité e2e assertent des codes de statut _et_ des codes d'erreur métier exacts — `403 guest.wrongEvent`, pas « une erreur ». Elles tournent contre un vrai serveur, une vraie base SQLite jetable et de vrais cookies, chaque worker sur son propre port. Les fixtures de médias incluent une bombe de pixels, un SVG renommé en `.jpg` et un script déguisé : les entrées hostiles sont des citoyens de première classe de cette suite.

Les seuils de couverture sont différenciés avec une justification : 100 % de branches sur `src/domain` et `src/application`, 90/85 sur les adaptateurs, 95/90 sur l'interface, 85/80 sur le web. Le commentaire dit « des planchers, jamais des objectifs », ce qui est la bonne façon d'en parler. Les harnais de test sont exclus du calcul plutôt que de le gonfler.

### Ce que le maillage laisse passer

F4 est l'illustration exacte de la limite du découpage en anneaux. Le test HTTP envoie un corps complet et passe ; le test React vérifie que le client appelle bien la bonne méthode et passe ; la fonctionnalité est cassée à 100 %. Aucun test ne fait traverser la frontière avec les _vraies_ données des deux côtés.

Le correctif n'est pas « plus de tests e2e » — ils coûtent des secondes — mais un test de contrat de transport : prendre les corps que `client.ts` construit réellement et les faire valider par les schémas zod du serveur. C'est du ring 4, cela s'exécute en millisecondes, et cela attrape toute cette classe de défaut. Le dépôt a déjà l'idée : `presenters/dtoContract.test.ts` fait exactement cela pour les _réponses_. Il manque le sens aller.

Deuxième trou : la régression visuelle et Firefox ne s'exécutent jamais (F6, F7). Quatre snapshots et un projet Playwright entier sont de la couverture apparente. Et `scripts/` échappe entièrement au filet (F14).

---

## 7. Compréhension par les agents IA

> C'est le meilleur dépôt pour agents que j'aie eu à examiner. Le tout est structurellement supérieur à ce que la plupart des projets obtiennent avec dix fois plus de documentation.

Ce qui fait la différence n'est pas la quantité — 3 800 lignes de `docs/`, 271 de CLAUDE.md — mais trois propriétés que les documentations d'agent n'ont presque jamais :

- **Les règles sont appliquées par la machine, pas par le document.** Un agent qui ignore CLAUDE.md §2 est arrêté par `npm run lint`. Un document qui n'est qu'un document est un document que l'agent finira par contredire.
- **La boucle de vérification est réellement rapide.** `npm run test:run` rend la main en 10,8 s. Un agent la lancera vraiment. Une suite à trois minutes est une suite qu'on saute.
- **Les commentaires disent _pourquoi_, avec le défaut concret en face.** « `pipeline`, jamais `pipe` : `pipe` laisse la réponse ouverte quand la source échoue, et un ZIP à moitié écrit ressemble exactement à un album complet. » Un agent qui lit cela ne refactorisera pas le motif par mégarde. Une section « Pièges » recense sept défauts de 1.0 qu'il ne faut pas redécouvrir, dont le bug du QR code où `?partyname=` était lu comme `?party`.

Le dispositif est complet : CLAUDE.md pour Claude, AGENTS.md neutre pour les autres agents, sept _skills_ dans `.claude/skills/` (toutes présentes, vérifié) qui donnent une recette par tâche récurrente, et six ADR qui documentent les décisions _et les alternatives rejetées_. Les noms prédisent le contenu : pour « approuver une photo », un agent trouvera `src/application/usecases/moderation/` sans chercher.

La discipline s'étend à la conservation des pièges découverts pendant la branche elle-même. Le `.gitignore` porte ce commentaire : un `photos/` nu correspondait à n'importe quelle profondeur et excluait silencieusement `src/domain/photos/`, `src/application/usecases/photos/` et tout l'adaptateur média — 33 fichiers source que `git add` ignorait, et qu'un clone neuf n'aurait pas pu construire. « Keep the slashes. » C'est exactement le genre de piège qu'un agent reproduirait sans cette ligne.

### Ce qu'il faudrait corriger

> **Statut — les trois sont corrigés.** §9 d'API.md s'ouvre sur un encadré qui dit que
> la section n'est pas le contrat, que rien n'y est implémenté, et que les deux routes
> de §9.10 répondent `404 route.notFound` aujourd'hui — vérifié : aucun routeur ne les
> monte et `server.ts` répond dans la forme d'erreur de l'API. CLAUDE.md §10 porte la
> même limite à l'endroit où il désigne API.md comme le contrat : « §§1–8 est le
> contrat, §9 ne l'est pas ». CLAUDE.md §2 nomme désormais la vraie règle,
> `no-restricted-imports` avec `patterns`, dit qu'il n'y a pas de plugin `import` dans
> ce projet, et donne les trois chaînes qu'un agent peut réellement chercher :
> `DOMAIN_FORBIDDEN`, `APPLICATION_FORBIDDEN`, et le bloc
> `files: ['src/infrastructure/**/*.ts']`. Le commentaire de `compose.yaml` : cf. F12.

- **API.md §9 est un piège pour un agent naïf.** Dix divergences connues y sont recensées, dont cinq défauts de code — et la section 9.10 propose deux routes (« la forme naturelle est `GET /api/join/:code` ») qui n'existent pas. Un agent qui lit le document comme « le contrat », ce que CLAUDE.md §10 lui dit de faire, peut coder contre une route hypothétique. La section mérite un avertissement en tête : _rien ici n'est implémenté ; ce sont des défauts et des propositions_.
- **Le commentaire de `compose.yaml` ment sur multer** (F12). Un agent chargé de dimensionner le déploiement tirera la mauvaise conclusion.
- **CLAUDE.md §2 renvoie à une règle ESLint introuvable par son nom.** Il écrit « `import/no-restricted-paths` style rules » — à lire comme « des règles dans ce genre », puisque la configuration utilise en réalité `no-restricted-imports` avec des `patterns`. L'enforcement est bien réel — je l'ai éprouvé — mais un agent qui cherche la règle par la chaîne citée ne trouvera rien, et le plugin `import` n'est même pas une dépendance du projet.

---

## 8. Recommandation

| Dimension    | Note   |                                                                                           |
| ------------ | ------ | ----------------------------------------------------------------------------------------- |
| Sécurité     | **A−** | Confidentialité et intégrité solides. La disponibilité est l'angle mort.                  |
| Architecture | **A**  | Hexagonale et vérifiée par le build. Une entorse de typage, à l'origine de F1.            |
| Tests        | **A−** | Excellents et rapides. Le sens client→serveur et le visuel ne sont pas couverts.          |
| Agents IA    | **A+** | Règles appliquées par la machine, boucle à 10 s, commentaires qui expliquent le pourquoi. |

### Avant la fusion

- **F1** — faire retourner un `Result` à `subscribe` et répondre 503 avant l'écriture des en-têtes. Sans cela le mur peut être éteint par n'importe qui, en silence.
- **F4** — ajouter le champ de mot de passe temporaire au panneau des modérateurs. Une fonctionnalité livrée qui échoue systématiquement ne doit pas passer.

### Dans la foulée

- **F2, F3** — borner les connexions SSE et la mémoire d'upload. Même classe de risque que F1 ; à traiter dans le même lot.
- **F6, F7** — brancher la régression visuelle et Firefox sur la CI, ou supprimer ce qui ne tourne pas.
- **Test de contrat client→serveur** — valider les corps que `client.ts` construit contre les schémas zod du serveur. C'est ce qui aurait attrapé F4, et cela coûte des millisecondes.

### Ensuite

- **F5, F8, F9, F10, F11** — canal de modération, quota transactionnel, rotation du jeton CSRF, contrat de la purge, numérotation des signaux.
- **F13** — ajouter le fichier LICENSE. Deux commits l'ont déjà signalé.
- Ajouter une entrée « épuisement de ressources » au tableau des risques acceptés de SECURITY.md, une fois F1–F3 traités : ce qui reste accepté doit être écrit.

---

Revue menée le 11 septembre 2026 sur `deuxpointzero` à 56 commits d'avance sur `main`, arbre de travail propre. Toutes les références `fichier:ligne` ont été lues dans le code, pas déduites d'un nom. Les affirmations de la section 2 ont été exécutées ou éprouvées.

Suite de tests exécutée pendant la revue : `npm run test:run` → 177 fichiers, 3 859 tests, 0 échec, 10,8 s.
