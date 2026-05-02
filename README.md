# EventSlide 📸
### Capture, Share, Project: Bring your party to life with our instant photo sharing software

EventSlide est une application moderne de partage de photos en temps réel pour vos événements. Les invités scannent un QR Code, prennent une photo, et elle s'affiche instantanément sur le grand écran après modération.

## ✨ Fonctionnalités clés
- **Temps réel (SSE)** : Affichage instantané des photos sur le diaporama sans rechargement.
- **Optimisation intelligente** : Compression automatique des photos (via Sharp) pour économiser l'espace et la bande passante.
- **Modération complète** : Galerie d'administration pour valider ou rejeter les photos avant projection.
- **Effets visuels** : Diaporama fluide avec transitions fondues et effet Ken Burns (zoom doux).
- **Accès simplifié** : Générateur de QR Code intégré pour les invités.
- **Multi-utilisateur** : Gestion de comptes administrateurs avec sessions sécurisées.

## 🚀 Installation rapide

1. **Prérequis** : Node.js 22.12+ (recommandé).
2. **Installation** :
   ```bash
   npm install
   ```
3. **Configuration** :
   - Copiez le fichier d'exemple : `cp .env.example .env`
   - Définissez un `SESSION_SECRET` robuste.
   - (Optionnel) Placez vos certificats SSL dans le dossier `/ssl` pour la production.
4. **Image par défaut** : Assurez-vous d'avoir une image `public/default.jpg` pour le lancement du diaporama.

## 🛠️ Développement et Production

### En développement
Lancez les deux terminaux suivants pour bénéficier du Hot Reload (Vite + Nodemon) :
- **Backend** : `npm run dev:back` (port 4300 par défaut)
- **Frontend** : `npm run dev:front` (port 5173 par défaut)

### En production
Générez le build optimisé et lancez le serveur :
```bash
npm run build
npm run start
```

## 🌐 Navigation

### Public
- `/upload` : Interface d'envoi pour les invités (optimisée mobile).
- `/upload?partyname=MonEvent` : Lien direct pour un événement spécifique.

### Administration (Sécurisé)
- `/admin` : Tableau de bord principal.
- `/admin/moderation` : File d'attente des photos (statut *pending* par défaut).
- `/admin/displayer` : Le diaporama à projeter.
- `/admin/qrcode` : Générateur de QR Code pour les invités.
- `/admin/users/new` : Création de nouveaux comptes modérateurs.

## ⚙️ Variables d'environnement
- `PORT` : Port d'écoute du serveur (défaut : `4300`).
- `SESSION_SECRET` : Clé de signature des sessions (requis).
- `SESSION_COOKIE_SECURE` : `true` pour activer le flag Secure (HTTPS requis).

### How to use
- Open `/login`, log in with `admin` / `password`
- Change your password
- Open `/admin/displayer` in fullscreen on a video projector (pro-tip: press Enter to change the time between 2 photos)
- Open `/admin/moderation` to allow/deny submitted pictures (green border = displayed, red border = hidden, red cross = delete)
- Share the `/upload` page link with your guests