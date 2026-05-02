# EventSlide
### Capture, Share, Project: Bring your party to life with our instant photo sharing software

EventSlide is a modern real-time photo sharing application for your events. Guests scan a QR Code, take a photo, and it is instantly displayed on the big screen after moderation.

## Key Features
- **Real-time (SSE)**: Instant photo display on the slideshow without reloading.
- **Smart Optimization**: Automatic photo compression (via Sharp) to save storage and bandwidth.
- **Full Moderation**: Admin gallery to validate or reject photos before projection.
- **Visual Effects**: Smooth slideshow with fade transitions and Ken Burns effect (soft zoom).
- **Simplified Access**: Integrated QR Code generator for guests.
- **Multi-user**: Admin account management with secure sessions.

## Quick Installation

1. **Prerequisites**: Node.js 22.12+ (recommended).
2. **Installation**:
   ```bash
   npm install
   ```
3. **Configuration**:
   - Copy the example file: `cp .env.example .env`
   - Set a strong `SESSION_SECRET`.
   - (Optional) Place your SSL certificates in the `/ssl` folder for production.
4. **Default Image**: Ensure you have a `public/default.jpg` image for the slideshow launch.

## Development and Production

### In Development
Run the following two terminals to benefit from Hot Reload (Vite + Nodemon):
- **Backend**: `npm run dev:back` (default port 4300)
- **Frontend**: `npm run dev:front` (default port 5173)

### In Production
Generate the optimized build and start the server:
```bash
npm run build
npm run start
```

## Navigation

### Public
- `/upload`: Upload interface for guests (mobile-optimized).
- `/upload?partyname=MyEvent`: Direct link for a specific event.

### Administration (Secure)
- `/admin`: Main dashboard.
- `/admin/moderation`: Photo queue (pending status by default).
- `/admin/displayer`: The slideshow to project.
- `/admin/qrcode`: QR Code generator for guests.
- `/admin/users/new`: Create new moderator accounts.

## Environment Variables
- `PORT`: Server listening port (default: `4300`).
- `SESSION_SECRET`: Session signing key (required).
- `SESSION_COOKIE_SECURE`: `true` to enable the Secure flag (HTTPS required).

### How to use
- Open `/login`, log in with `admin` / `password`
- Change your password
- Open `/admin/displayer` in fullscreen on a video projector (pro-tip: press Enter to change the time between 2 photos)
- Open `/admin/moderation` to allow/deny submitted pictures (green border = displayed, red border = hidden, red cross = delete)
- Share the `/upload` page link with your guests