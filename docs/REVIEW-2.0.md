# Revue de code #2 — `deuxpointzero` face à `main`

**Projet** EventSlide · **Date** 12 septembre 2026 · **Base** `main` · **Branche** `deuxpointzero` (66 commits d'avance, arbre de travail propre)

> **Ce fichier remplace la revue du 11 septembre** (branche à 56 commits, constats F1–F18), qui occupait ce chemin et dont les dix-huit constats sont désormais tous traités — voir le tableau de suivi en §2. L'ancienne version reste consultable dans l'historique : `git show f778c01:docs/REVIEW-2.0.md`. Le nom de fichier est conservé parce que [CLAUDE.md](../CLAUDE.md) y renvoie par numéro de constat ; le renommer créerait exactement le défaut décrit en G5.

Dix commits ont atterri depuis la première revue, pour +9 582 lignes. **Les dix-huit constats sont tous traités** — pas contournés : la plupart des correctifs s'attaquent à la cause et non au symptôme, et trois d'entre eux ont fait remonter des défauts que la revue n'avait pas vus. Deux fonctionnalités neuves sont arrivées en même temps (balayage de rétention, sauvegarde/restauration), et c'est dans cette surface neuve que se trouve le seul constat bloquant de cette revue.

|                         | Revue #1 (11 sept.)  | Revue #2 (12 sept.)                |
| ----------------------- | -------------------- | ---------------------------------- |
| Commits                 | 56                   | **66**                             |
| Fichiers modifiés       | 604                  | **621**                            |
| Lignes ajoutées         | +80 675              | **+90 257**                        |
| Tests                   | 3 859 / 177 fichiers | **4 107 / 183 fichiers**           |
| Échecs                  | 0 (10,8 s)           | **0 (10,5 s)**                     |
| Constats levés          | 18                   | **7** (dont 1 élevé)               |
| Constats encore ouverts | 18                   | **6** — G3 est clos par ce fichier |

---

## 1. Verdict

> **Fusionnable après correction de G1.** Les deux bloquants de la revue précédente (F1, F4) sont corrigés à la racine. Un nouveau bloquant les remplace : `restoreBackup` écrit les fichiers d'une archive sans vérifier qu'ils restent sous la racine média, et la vérification d'intégrité valide la même chaîne traversée — une archive fabriquée passe les contrôles et écrit où elle veut. Les six autres constats sont du travail de suivi.

La qualité de la réponse mérite d'être notée précisément, parce qu'elle n'est pas la réponse habituelle à une revue. Trois exemples.

**F1 a été corrigé par le type, pas par une rustine.** La revue signalait que `Unsubscribe` n'avait pas de canal d'échec et que « la couche HTTP décide de répondre 503 » était donc inexprimable. Le port a été changé : `subscribe` retourne un `Result<Unsubscribe, DomainError>`, et `openStream` s'abonne _avant_ d'écrire le moindre en-tête, avec le commentaire qui explique pourquoi cet ordre est toute l'affaire. C'est la correction structurelle, pas le contournement.

**Trois correctifs ont trouvé des défauts que la revue avait manqués.** En bornant `BOOTSTRAP_OWNER_PASSWORD` (F16), le travail a mis au jour que `compose.yaml` rend `${BOOTSTRAP_OWNER_PASSWORD:-}` en chaîne vide : le cas ordinaire — `docker compose up` sans premier propriétaire — appelait le cas d'usage avec un mot de passe vide au lieu de ne rien faire. En étendant la couverture à `scripts/` (F14), il est apparu que `scripts/backup.test.ts` existait avec quinze tests que le `include` de vitest ne ramassait pas : quinze tests qui ne tournaient nulle part. Et le correctif de F8 a déplacé l'application du quota dans la transaction d'écriture du dépôt, ce qui a nécessité un nouveau module de domaine `quota.ts` plutôt qu'un verrou applicatif.

**Une recommandation de la revue précédente était fausse, et l'argumentaire qui la réfute est dans le code.** Voir §5.

---

## 2. Suivi des dix-huit constats

Chaque ligne a été vérifiée dans le code, pas déduite du message de commit.

| #       | Constat                                        | État                               | Comment                                                                                                                                                                                    |
| ------- | ---------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F1**  | Plafond SSE en échec silencieux                | ✅ **Corrigé (racine)**            | `subscribe` retourne un `Result` ; `openStream` s'abonne avant d'écrire ; `503` + `Retry-After: 30` ; chien de garde client à 45 s sur une trame `ping` nommée                             |
| **F2**  | Pas de limite sur le flux SSE                  | ✅ **Corrigé**                     | `streamConnectionLimiter` — concurrence, pas débit : 12 flux par clé IP, 500 par processus, relâchés sur `close`, garde anti-double-libération                                             |
| **F3**  | Mémoire d'upload non bornée en agrégat         | ✅ **Corrigé**                     | `MAX_UPLOAD_BYTES_PER_REQUEST = 150 MB`, jamais inférieur à `MAX_UPLOAD_BYTES`                                                                                                             |
| **F4**  | Invitation de modérateur cassée à 100 %        | ✅ **Corrigé + filet**             | Le panneau porte le champ ; `requestContract.test.ts` (754 lignes) et un parcours e2e dédié                                                                                                |
| **F5**  | Console abonnée au canal public                | ✅ **Corrigé**                     | `api.moderationStreamUrl`, avec un test qui assure que les deux URL diffèrent                                                                                                              |
| **F6**  | Régression visuelle jamais exécutée en CI      | ✅ **Corrigé (mieux que demandé)** | Job qui rend sa propre référence depuis la base de fusion sur le même _runner_, donc la dérive de plateforme ne peut plus rougir le job                                                    |
| **F7**  | `firefox-desktop` hors matrice                 | ✅ **Corrigé**                     | Ajouté à la matrice e2e                                                                                                                                                                    |
| **F8**  | Quota franchissable en concurrence             | ✅ **Corrigé (racine)**            | Application déplacée dans la transaction d'écriture (`sqlitePhotoRepository.ts:459-516`) ; le contrôle du cas d'usage est explicitement « le contrôle bon marché, pas celui qui applique » |
| **F9**  | Jeton CSRF ni lié ni renouvelé                 | ✅ **Corrigé à moitié, à raison**  | `rotateCsrfToken` sur connexion et déconnexion. La signature est refusée avec un argumentaire correct — voir §5                                                                            |
| **F10** | `DELETE /events/:slug` sans section de contrat | ✅ **Corrigé**                     | Section écrite. Inventaire revérifié : **37 routes en code, 37 documentées, correspondance exacte**                                                                                        |
| **F11** | Identifiants SSE divergents par client         | ✅ **Corrigé (racine)**            | `Delivery.sequence` frappé une fois par publication et partagé ; `SignalLog.record` déduplique                                                                                             |
| **F12** | Commentaire tmpfs faux                         | ✅ **Corrigé**                     | Le commentaire dit maintenant que rien n'y est écrit, et pourquoi le tmpfs reste                                                                                                           |
| **F13** | LICENSE absent                                 | ✅ **Corrigé**                     | Texte GPL-3.0 ajouté                                                                                                                                                                       |
| **F14** | `scripts/` hors couverture                     | ✅ **Corrigé + trouvaille**        | `include` et seuils étendus ; a révélé 15 tests qui ne tournaient nulle part                                                                                                               |
| **F15** | Avertissement `MODULE_TYPELESS_PACKAGE_JSON`   | ⚠️ **Corrigé, avec séquelles**     | Renommé `eslint.config.mjs`. Introduit **G2** et **G5**                                                                                                                                    |
| **F16** | `BOOTSTRAP_OWNER_PASSWORD` non borné           | ✅ **Corrigé + trouvaille**        | Politique du domaine appliquée à la configuration ; a révélé le bug de la chaîne vide rendue par Compose                                                                                   |
| **F17** | Clé de limitation sur _slug_ non validé        | ✅ **Corrigé**                     | `Slug.create` dans la clé, tout le reste retombe sur un seul godet `'none'`                                                                                                                |
| **F18** | `Map` des journaux jamais purgée               | ✅ **Corrigé (racine)**            | `Channel` compté par référence, supprimé au dernier départ                                                                                                                                 |

Trois défauts que la documentation s'était signalés à elle-même sont également fermés : API.md §9.2 (invitation), §9.6 (canal de modération) et §9.9 (plafond SSE) ont disparu de la section.

---

## 3. Vérifications mécaniques, rejouées

| Affirmation                                            | Méthode                                                                          | Résultat                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Les frontières hexagonales tiennent toujours           | Fichier fautif réinjecté dans `src/domain/`, `npx eslint`                        | **Exact** — 3 violations sur 3 rejetées, y compris l'import relatif |
| La suite est verte                                     | `npm run test:run`                                                               | **Exact** — 4 107 / 4 107 en 10,5 s, 183 fichiers                   |
| L'avertissement Node a disparu                         | Même exécution ESLint                                                            | **Exact** — plus de `MODULE_TYPELESS_PACKAGE_JSON`                  |
| Chaque route documentée existe, et réciproquement      | Inventaire `router.*` comparé aux en-têtes `###` d'API.md, paramètres normalisés | **Exact** — 37 ↔ 37, aucun écart dans les deux sens                 |
| `eslint.config.mjs` est toujours typé                  | `npx tsc -p tsconfig.tools.json --listFiles`                                     | **Faux** — le fichier n'est dans aucun programme tsconfig (**G2**)  |
| Le restore contient les écritures sous la racine média | Lecture de `restoreBackup` et du schéma de manifeste                             | **Faux** — aucun contrôle de confinement (**G1**)                   |
| API.md §9 ne recense plus de défaut de code            | Lecture de la section                                                            | **Faux** — 9.3, 9.4, 9.5, 9.7 et 9.10 restent ouverts (**G4**)      |

---

## 4. Les sept nouveaux constats

### Gravité élevée

#### G1 — Traversée de chemin à la restauration : une archive fabriquée écrit où elle veut

`src/infrastructure/db/backupArchive.ts:96` · `src/infrastructure/db/backupArchive.ts:875-888` · `src/infrastructure/db/backupArchive.ts:221`

Le manifeste décrit chaque fichier média par un chemin, validé par `entrySchema` :

```ts
const entrySchema = z.object({
  /** Relative to `<archive>/media`, always with `/` separators. */
  path: z.string().min(1),
  ...
})
```

« Relatif » est un commentaire, pas une contrainte. `restoreBackup` s'en sert directement :

```ts
for (const entry of manifest.media.entries) {
  const relative = fromPosix(entry.path)
  const restored = await streamThroughSha256(
    join(root, MEDIA_DIR, relative),
    join(target.mediaRoot, relative),   // ← aucun contrôle de confinement
  )
```

et `streamThroughSha256` fait `await mkdir(dirname(to), { recursive: true })` avant d'écrire : les répertoires intermédiaires sont créés aussi. Un manifeste portant `"path": "../../app/dist/server/main/index.js"` écrit le contenu que l'attaquant a placé dans l'archive par-dessus le serveur compilé, avec les droits de l'opérateur qui lance la restauration.

**Ce qui rend le défaut sérieux, c'est que toute la machinerie d'intégrité coopère.** `verifyBackup` résout le fichier source avec exactement la même expression traversée (`join(root, MEDIA_DIR, fromPosix(entry.path))`, ligne 711), y trouve le fichier que l'attaquant a placé, vérifie sa taille et son sha256 — et déclare l'archive saine. Le `--force` que la restauration exige protège la cible existante, pas la sortie de l'arborescence. Et la vérification de somme de contrôle de la copie a lieu **après** l'écriture.

La documentation du module anticipe la falsification (« The checksums are unkeyed. Anyone who can edit the archive can… », ligne 586) mais la traite comme une altération du _contenu_, pas comme une évasion de l'_emplacement_. Ce sont deux menaces différentes : la première rend une sauvegarde inutilisable, la seconde donne l'exécution de code.

Le modèle de menace est réaliste pour l'outil concerné. Une archive de sauvegarde est précisément ce qui voyage : clé USB, NAS, stockage objet, transfert entre l'hébergeur et le client. `restore` existe pour lire un fichier venu d'ailleurs.

**Correctif.** Rejeter le chemin à l'analyse plutôt qu'à l'usage, ce qui protège `verify` et `restore` d'un seul geste :

```ts
path: z.string().min(1).refine(
  (p) => !p.split('/').some((s) => s === '' || s === '.' || s === '..') && !/^[a-zA-Z]:/.test(p),
  { message: 'a media entry path must stay inside the archive' },
),
```

Et, en ceinture et bretelles, vérifier le confinement à l'écriture : `resolve(target.mediaRoot, relative).startsWith(resolve(target.mediaRoot) + sep)`. Le test qui manque est un cas de manifeste hostile dans `backupArchive.test.ts` — la même famille que les charges utiles hostiles déjà présentes dans `tests/e2e/fixtures/media.ts`, qui sont l'un des points forts de cette base de code.

### Gravité moyenne

#### G2 — Le renommage d'ESLint a sorti la configuration de tout programme TypeScript

`tsconfig.tools.json:18`

F15 a renommé `eslint.config.js` en `eslint.config.mjs`. `tsconfig.tools.json` liste toujours l'ancien nom :

```json
"include": [
  "tests/**/*.ts", "scripts/**/*.ts",
  "vitest.config.ts", "playwright.config.ts",
  "eslint.config.js"
]
```

Une entrée d'`include` qui ne correspond à rien est silencieuse — pas d'erreur, pas d'avertissement. Vérifié : `npx tsc -p tsconfig.tools.json --listFiles` ne contient aucune ligne pour `eslint.config`. Le fichier qui **applique toute l'architecture** n'est plus typé par aucun des quatre projets, et `npm run typecheck` reste vert en couvrant moins qu'avant.

C'est la classe de défaut que ce dépôt combat partout ailleurs : un garde-fou qui a cessé de garder sans rien dire, exactement comme les quinze tests de `scripts/backup.test.ts` que F14 a exhumés.

**Correctif.** `"eslint.config.mjs"` dans `include`, et vérifier que `allowJs` permet de le charger. Plus durablement : un test qui assure que chaque fichier de configuration racine appartient à au moins un programme tsconfig — le même raisonnement que `requestContract.test.ts`, appliqué à la configuration.

#### G3 — Une revue périmée occupait `docs/` sans marque d'obsolescence — corrigé par ce fichier

`docs/REVIEW-2.0.md` · `CLAUDE.md:274`

Le rapport du 11 septembre était commité tel quel à ce chemin. Son en-tête annonçait « branche à 56 commits », son verdict disait « **Fusionnable après correction de F1 et F4** », et il décrivait dix-huit constats dont quinze étaient déjà corrigés au moment de cette revue. Rien dans le document ne disait qu'il était historique.

Le risque était concret : CLAUDE.md y renvoie par numéro de constat (« F15 in docs/REVIEW-2.0.md »), ce qui le désigne comme référence vivante, et AGENTS.md ordonne aux agents de lire `docs/`. Un agent — ou un nouvel arrivant — y trouvait une liste de tâches à 85 % faite, présentée comme à faire, et un verdict de fusion qui n'était plus le bon.

**Traité :** ce fichier remplace l'ancien au même chemin. Le tableau §2 donne le statut par constat, à la manière dont API.md §9 marque chaque entrée **doc corrected above** / **code defect** / **stale code** — c'est la discipline que le dépôt applique déjà ailleurs et qui manquait ici. Le nom est conservé pour que le lien de CLAUDE.md continue de résoudre, et le renvoi à F15 reste valide puisque §2 porte cette ligne.

**Ce qui reste à faire.** Une règle, pas un correctif ponctuel : une revue vit à ce chemin et n'y est jamais accumulée. La suivante remplace celle-ci et reprend son tableau de suivi, sans quoi le défaut revient au cycle d'après.

#### G4 — API.md §9 recense toujours cinq divergences, dont deux paramètres acceptés puis ignorés

`docs/API.md:1289` · `docs/API.md:1297`

La section a fondu — 9.2, 9.6 et 9.9 sont fermés — mais **9.3, 9.4, 9.5, 9.7 et 9.10** restent. Deux vérifiées dans le code :

**9.3.** `eventRoutes.ts:294` appelle `guestListQuery.parse(req.query)` et jette le résultat. Le schéma annonce `activeWithinMinutes`, borné de 1 à 1 440 minutes, défaut 30. `listGuests.ts:27` utilise `PRESENCE_WINDOW_MS = 5 * 60 * 1000`. Un hôte qui demande « actifs depuis deux heures » reçoit cinq minutes, sans erreur et sans indication.

**9.4.** `moderationQueueQuery` déclare `cursor: z.string().max(512).optional()`. `moderationRoutes.ts` ne le lit jamais et répond toujours `nextCursor: null`, avec le commentaire qui explique que la file _ne peut pas_ être paginée par curseur. Le paramètre est donc accepté, borné, et sans effet — par conception.

C'est la défaillance précise que `.strict()` existe pour empêcher : un champ refusé apprend quelque chose à l'appelant, un champ accepté et ignoré lui ment. Ces deux-là sont ouverts depuis la revue précédente et n'ont été touchés par aucun des dix commits.

**Correctif.** Pour chacun, l'une des deux branches — brancher le paramètre, ou le retirer du schéma pour que l'envoyer devienne un 400. Le retrait est un choix légitime et documenté ; le laisser accepté ne l'est pas. Note pour §9.10 : `resolveJoinCode` et `renameGuest` restent câblés sans route depuis deux revues, avec leurs tests unitaires — du code mort qui a l'air vivant.

### Gravité faible

#### G5 — Six références au nom `eslint.config.js` survivent au renommage

`docs/ARCHITECTURE.md:12, 85, 91, 520` · `docs/adr/0001-hexagonal-architecture.md:12` · `src/interface/http/presenters/dtoContract.test.ts:30` · `src/interface/http/presenters/requestContract.test.ts:35` · `web/src/features/wall/hooks/useLayoutParam.ts:10`

Sans conséquence à l'exécution, mais ARCHITECTURE.md:91 écrit `// eslint.config.js — abridged; the file is the source of truth` juste au-dessus d'un extrait — un lecteur qui va chercher le fichier nommé ne le trouve pas. Même catégorie que le constat de la revue précédente sur la règle citée sous un nom qui n'existe pas : la documentation reste juste sur le fond et fausse sur l'adresse.

**Correctif.** Un `grep -rl 'eslint\.config\.js'` et un remplacement. À faire avec **G2**, qui est la même cause.

#### G6 — Le message de succès de `backup` apprend à l'opérateur à toujours passer `--force`

`scripts/backup.ts:180`

Une sauvegarde réussie affiche :

```
Copy it off this machine. Restore with:
  npm run restore -- <archive> --force
```

`--force` est le drapeau qui désactive le refus d'écraser une installation existante — le garde-fou que `restore.ts` décrit comme « the only way past that ». L'imprimer inconditionnellement dans le chemin heureux en fait la formule qu'on copie-colle, y compris le jour où la cible n'était pas censée être occupée. `restore.ts:127` connaît pourtant la distinction et l'affiche correctement (« The target is empty, so the real run needs no `--force` »).

**Correctif.** Imprimer la commande sans `--force`, en ajoutant une ligne du type « si la cible contient déjà une installation, `--force` est requis et détruira ce qui s'y trouve ».

#### G7 — La fenêtre où la restauration a détruit les deux moitiés

`src/infrastructure/db/backupArchive.ts:869-895`

L'ordre est : vérifier l'archive en profondeur, remplacer la base par un fichier temporaire renommé, puis `rm -rf` la racine média et recopier fichier par fichier. Si une copie média échoue en cours de route — le code lève alors `The restore is incomplete` — l'ancienne base **et** l'ancienne racine média ont déjà disparu, et la nouvelle est partielle.

La conception le sait et le borne : la vérification profonde tourne avant toute destruction, le message d'erreur dit que la restauration est incomplète, et la docstring explique pourquoi copier plusieurs gigaoctets deux fois n'est pas un prix qu'une machine auto-hébergée peut payer. Le raisonnement est juste. Il reste que c'est la seule fenêtre de tout le produit où une opération interrompue laisse l'opérateur sans les données d'avant ni celles d'après.

**Correctif.** Pas de restructuration : rendre la fenêtre lisible. Un message d'erreur qui nomme l'archive, dit que la cible est maintenant incomplète et que **relancer la même commande la termine** — ce qui est vrai, la copie étant idempotente. Un opérateur qui lit « incomplete » à 2 h du matin doit savoir en une ligne que rien n'est perdu tant que l'archive est là.

---

## 5. Sécurité

> Le durcissement du chemin temps réel est fait, et bien fait. Le risque s'est déplacé vers la surface neuve : sauvegarde et restauration.

Les trois constats de disponibilité de la revue précédente sont fermés, et fermés par la bonne mécanique. Le plafond d'abonnés répond désormais `503` avec `Retry-After` **avant** le premier en-tête — le commentaire du code souligne que l'ordre des deux premières instructions est toute l'affaire, ce qui est exact : une fois `200 text/event-stream` sur le fil, il n'existe plus aucun moyen de dire non. Le limiteur de flux compte la _concurrence_ et non le débit, avec la justification explicite qu'un limiteur par minute laisserait un client tenir deux cents connexions à perpétuité en les ouvrant lentement. La libération est idempotente, avec un commentaire qui nomme la fuite que la double-libération provoquerait sur huit heures.

Le côté client a reçu la moitié qui manquait : le _heartbeat_ porte maintenant une trame nommée `ping` sans `id:`, invisible pour le consommateur, dont le seul rôle est d'alimenter un chien de garde à 45 secondes. Trois battements manqués ferment et rouvrent la connexion. C'est ce qui distingue enfin une soirée calme d'un tuyau qui a cessé de livrer.

L'application du quota est passée dans la transaction d'écriture du dépôt SQLite, le cas d'usage conservant un contrôle explicitement étiqueté « le contrôle bon marché, pas celui qui applique ». C'est la bonne répartition : le contrôle qui informe l'invité reste en amont, celui qui garantit l'invariant est là où la sérialisation existe.

### La recommandation de la revue précédente qui était fausse

F9 demandait deux choses : renouveler le jeton CSRF au changement d'identité, et le signer. **La première est faite. La seconde a été refusée, et le refus est justifié.**

L'argumentaire est dans `csrf.ts:82-133`, en trois points dont le premier suffit : signer une valeur aléatoire ne lie rien. Le vérificateur ne peut comparer que « cette signature est la mienne » et « le cookie égale l'en-tête » ; rien dans la paire ne nomme _ce_ navigateur. Un attaquant capable d'écrire nos cookies peut aussi bien nous **demander** un jeton — n'importe quel GET en émet un — puis injecter cette valeur authentiquement signée comme cookie et l'écho en en-tête. Cela vérifie. La revue recommandait de convertir un jeton infalsifiable-par-devinette en jeton infalsifiable-par-devinette.

Le lier à la session marcherait, et le code explique pourquoi c'est hors de portée ici : `saveUninitialized: false` fait que chaque requête anonyme reçoit un `req.sessionID` neuf et jamais stocké, et `POST /api/join` — la requête qui _crée_ l'identité invité — s'exécute avant qu'il y ait quoi que ce soit à lier. La liaison protégerait les hôtes, qui tiennent déjà un cookie de session `HttpOnly` régénéré à la connexion, et laisserait le flux d'upload invité — celui que la revue elle-même désigne comme le plus exposé — exactement où il est.

Le troisième point est décisif : `x-csrf-token` n'est pas un en-tête sûr au sens CORS, il exige donc un préliminaire, et ce serveur ne monte aucun intergiciel CORS et n'émet aucun `Access-Control-Allow-*`. Un sous-domaine compromis peut écrire nos cookies ; il reste une _autre origine_ et ne peut pas poser l'en-tête. Le code va jusqu'à nommer la dépendance exacte de la décision — « si CORS est ajouté un jour, rouvrir le sujet » — et l'alternative écartée, le préfixe `__Host-`, avec la raison de son rejet (il impose `Secure`, ce qui casserait les installations auto-hébergées en HTTP simple).

C'est la bonne façon de répondre à une revue : ne pas appliquer ce qui est demandé quand c'est faux, et écrire pourquoi à l'endroit où le prochain lecteur refera l'analyse.

### État des contrôles

| Contrôle                   | État           | Évolution depuis #1                                                        |
| -------------------------- | -------------- | -------------------------------------------------------------------------- |
| Isolation entre événements | **Solide**     | inchangé                                                                   |
| Durcissement des uploads   | **Solide**     | + borne agrégée de 150 Mo par requête                                      |
| Jeton invité               | **Solide**     | inchangé                                                                   |
| Authentification hôte      | **Solide**     | + rotation CSRF à la connexion et à la déconnexion                         |
| Injection SQL              | **Solide**     | inchangé                                                                   |
| XSS                        | **Solide**     | inchangé                                                                   |
| CSRF                       | **Solide**     | ↑ rotation faite, non-signature argumentée                                 |
| Limitation de débit        | **Solide**     | ↑ concurrence SSE bornée, clés de godet validées                           |
| Épuisement de ressources   | **Couvert**    | ↑ était l'angle mort de #1 ; 12 flux/client, 500/processus, 150 Mo/requête |
| Sauvegarde et restauration | **Défaillant** | ⚠️ **surface neuve** — traversée de chemin (**G1**)                        |
| Suppression sur rétention  | **Correct**    | nouveau — garde anti-chevauchement, `unref`, reprise par construction      |

Le tableau des risques acceptés de SECURITY.md §12 mérite maintenant deux lignes qu'il n'a pas : ce qui reste accepté sur l'épuisement de ressources après ces bornes, et le fait qu'une archive de sauvegarde est un intrant non fiable dont les sommes de contrôle ne sont pas authentifiées.

---

## 6. Architecture

> Les frontières tiennent toujours — vérifié, pas relu — et les correctifs les ont renforcées au lieu de les contourner.

La sonde a été rejouée : un fichier importe `node:crypto`, `fs` et `../application/ports/clock` depuis `src/domain/`, ESLint rejette les trois avec les messages qui expliquent quoi faire à la place. Rien n'a été relâché pour faire passer les correctifs.

Les deux entorses relevées en #1 sont réparées, et l'une l'a été à la racine. `Unsubscribe` porte maintenant son échec dans un `Result`, comme tout le reste du code : la signature peut enfin exprimer ce que le commentaire promettait. Et `const logs = new Map()` est devenu un `Channel` compté par référence, créé au premier abonné et supprimé au dernier — l'état n'est plus immortel, même s'il reste au niveau du module.

Le nouveau code respecte le découpage. `retentionSweeper` vit dans `src/main` parce que la racine de composition est la seule couche autorisée à posséder un timer, et il est un module à part plutôt que quatre lignes dans `container.ts` — justifié par le fait qu'un `setInterval` dans la racine de composition est intestable par construction. Il ne décide rien de la rétention : il prend une horloge et une fonction de balayage. La garde anti-chevauchement est correcte (assignation avant le premier `await`), le timer est `unref`é pour ne pas retenir le processus pendant `docker stop`, et l'abandon au démarrage de l'arrêt est justifié par la reprise : le balayage supprime le média puis la ligne, donc un événement interrompu est un événement dont la ligne existe encore et que le balayage suivant reprend.

`backupArchive.ts` fait un choix structurel qui mérite d'être relevé : **l'archive est un répertoire, ni tar ni zip**, alors qu'`archiver` est déjà une dépendance. La première raison donnée est que `VACUUM INTO` écrit vers un chemin et ne peut pas écrire dans un flux. La conséquence heureuse est qu'il n'y a pas de _zip-slip_ possible — ce qui rend G1 d'autant plus regrettable : la traversée revient par le manifeste, la seule porte que ce choix de format laissait ouverte.

`VACUUM INTO` est par ailleurs la bonne réponse au problème que SECURITY.md §11 posait depuis le début : copier une base SQLite en WAL à chaud donne une sauvegarde corrompue, parce que les octets du `.sqlite` ne sont que la moitié de l'histoire. La restauration rejoue ensuite `migrate` contre la base restaurée — le même appel que `container.ts` au démarrage — pour que l'incompatibilité soit découverte par la personne qui restaure et non par un hôte dont le mur ne monte pas.

La régression structurelle de ce cycle est **G2** : le renommage de la configuration ESLint l'a sortie de tout programme TypeScript, silencieusement.

---

## 7. Qualité des tests

> 4 107 tests en 10,5 secondes, et la boucle n'a pas ralenti malgré +248 tests et deux fonctionnalités.

Le test recommandé en #1 existe, et il est meilleur que la recommandation. `requestContract.test.ts` (754 lignes) compare les corps que `web/src/lib/api/client.ts` construit aux schémas zod qui les analysent — mais **ne restitue aucun des deux côtés** : le serveur est le vrai objet de schéma, importé et interrogé ; le client est lu dans son propre texte source et parcouru par l'AST TypeScript, parce que le lint interdit à `src/interface` d'importer `web/**`. L'appariement est _dérivé_ de l'ordre de montage des routeurs, à la manière dont Express apparierait, si bien qu'un point d'entrée ajouté d'un seul côté apparaît comme un appel non apparié plutôt que comme un silence.

La docstring énumère aussi ce que le test **ne peut pas** attraper — une valeur de mauvaise longueur, de mauvais format ou hors énumération — avec la raison : « un test de contrat dont les angles morts sont inconnus finit par inspirer plus de confiance qu'il n'en mérite ». C'est le bon réflexe, et il est rare.

Le job de régression visuelle est également au-dessus de ce qui était demandé. Le problème réel n'était pas l'absence de job mais l'impossibilité d'en écrire un : une image de référence est spécifique à la plateforme, et pointer un _runner_ Ubuntu sur des captures générées sous Windows produit un job rouge en permanence — donc un job que plus personne ne lit. La solution rend la référence _depuis la base de fusion, sur le même runner, dans la même exécution_, puis compare à la tête. Les deux côtés partagent un Chromium, une pile de polices et une machine : un écart ne peut plus signifier que « cette _pull request_ a changé l'apparence du mur ». Un garde-fou vérifie même que la base a bien rendu le nombre de références attendu, avec un message qui explique que c'est un harnais cassé et non une régression.

Les seuils de `scripts/` utilisent des valeurs **négatives** — `{ statements: -280, branches: -109 }` — c'est-à-dire un plafond de lignes non couvertes plutôt qu'un plancher de pourcentage. La différence compte : c'est un cliquet qui ne peut que se resserrer, et le commentaire le nomme « a ratchet, not a floor » en listant ce qui est encore à zéro.

Ce qui reste à faire côté tests : **G1 n'a pas de test**, et devrait en avoir un du genre le mieux établi de ce dépôt — un manifeste hostile, à côté des charges utiles hostiles que `tests/e2e/fixtures/media.ts` contient déjà (bombe de pixels, SVG renommé `.jpg`, script déguisé). Et **G2** montre qu'aucun test ne vérifie que les fichiers de configuration racine appartiennent bien à un programme tsconfig.

---

## 8. Compréhension par les agents IA

> La qualité de fond ne bouge pas — c'est l'hygiène des références qui s'est dégradée, et sur exactement deux points.

Tout ce qui fondait la note de #1 est intact : règles appliquées par la machine plutôt que par le document, boucle de vérification à 10 secondes, commentaires qui donnent le _pourquoi_ avec le défaut concret en face. Le nouveau code entretient la tradition et l'améliore même : la docstring de `csrf.ts` sur la non-signature est un modèle — elle anticipe la question, y répond en trois points ordonnés par poids, nomme la condition qui invaliderait la décision (« si CORS est ajouté, rouvrir ») et l'alternative écartée avec sa raison. Un agent qui lit cela ne « corrigera » pas le code en ajoutant une signature.

Les deux régressions sont des problèmes d'adresse, pas de contenu :

**G3 — une revue périmée occupait `docs/` sans date de péremption**, avec un verdict — « fusionnable après F1 et F4 » — qui n'était plus vrai, et un renvoi depuis CLAUDE.md qui la désignait comme référence vivante. Un agent qui lit `docs/` comme AGENTS.md le lui ordonne y trouvait une liste de travail à 85 % faite et la prenait pour l'état courant. Clos par ce fichier, qui remplace l'ancien au même chemin et porte le statut par constat en §2 — la discipline qu'API.md §9 applique déjà. La règle à tenir est que ce chemin porte une revue, jamais une pile.

**G5 — six références pointent vers un nom de fichier qui n'existe plus.** Dont ARCHITECTURE.md:91, qui écrit `// eslint.config.js — abridged; the file is the source of truth` au-dessus d'un extrait. La source de vérité désignée est introuvable sous ce nom.

Les deux sont la même leçon, et c'est celle que **G2** paie au prix fort : dans ce dépôt, un renommage n'est jamais une opération locale, parce que les fichiers de configuration sont cités nommément par la documentation, par les commentaires, par les tests et par les tsconfig. Cela vaut une ligne dans la section « Pièges » de CLAUDE.md, qui est exactement l'endroit prévu pour ce genre de chose.

Un ajout à porter au crédit du cycle : `docs/API.md` est maintenant exact au point d'être vérifiable mécaniquement — 37 routes en code, 37 sections `###`, correspondance exacte dans les deux sens. Pour un agent qui code contre le contrat, c'est la propriété qui compte le plus, et elle est désormais tenue.

---

## 9. Recommandation

| Dimension    | #1  | #2     |                                                                                              |
| ------------ | --- | ------ | -------------------------------------------------------------------------------------------- |
| Sécurité     | A−  | **A−** | Disponibilité couverte ; le risque est passé à la surface sauvegarde/restauration (G1)       |
| Architecture | A   | **A**  | Les deux entorses réparées, dont une par le type. Une régression de configuration (G2)       |
| Tests        | A−  | **A**  | Contrat client→serveur en place, régression visuelle réellement exécutée, `scripts/` couvert |
| Agents IA    | A+  | **A**  | Fond intact ; références périmées (G3 clos ici, G5 ouvert)                                   |

### Avant la fusion

- **G1** — contraindre `entrySchema.path` dans le schéma, et vérifier le confinement à l'écriture. Une archive est un intrant non fiable ; aujourd'hui elle choisit où le restore écrit. Ajouter le test de manifeste hostile.

### Dans la foulée

- **G2** — remettre `eslint.config.mjs` dans `tsconfig.tools.json`. Un garde-fou qui a cessé de garder en silence est exactement ce que ce dépôt combat partout ailleurs.
- **G4** — trancher 9.3 et 9.4 : brancher le paramètre, ou le retirer du schéma. Un champ accepté et ignoré ment à l'appelant.

### Ensuite

- **G5, G6, G7** — noms de fichiers périmés, message de `backup` qui normalise `--force`, message d'erreur du restore incomplet qui doit dire que relancer termine le travail.
- **§9.5, §9.7, §9.10 d'API.md** — crochets e2e morts, DTO divergent, deux cas d'usage câblés sans route. Ouverts depuis deux revues.
- Deux lignes à ajouter au tableau des risques acceptés de SECURITY.md §12 : ce qui reste accepté sur l'épuisement de ressources après ces bornes, et le statut d'intrant non authentifié d'une archive de sauvegarde.
- Une entrée « Pièges » dans CLAUDE.md : renommer un fichier de configuration touche la documentation, les commentaires, les tests et les tsconfig — G2 et G5 sortent toutes deux du même renommage.

---

Revue menée le 12 septembre 2026 sur `deuxpointzero` à 66 commits d'avance sur `main`, arbre de travail propre. Toutes les références `fichier:ligne` ont été lues dans le code. Chaque ligne du tableau de suivi §2 a été vérifiée dans le code source, pas déduite d'un message de commit.

Vérifications exécutées pendant la revue : `npm run test:run` → 183 fichiers, 4 107 tests, 0 échec, 10,5 s · sonde ESLint sur `src/domain/` → 3 violations sur 3 rejetées · `npx tsc -p tsconfig.tools.json --listFiles` → `eslint.config.mjs` absent du programme · inventaire des routes → 37 ↔ 37.
