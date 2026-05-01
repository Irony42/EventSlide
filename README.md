# EventSlide
## Capture, Share, Project : Bring your party to life with our instant photo sharing software

### How to install:
1. Place your certificates in the ssl folder.
2. Place a default picture in public/default.jpg
3. Use node 22.12+ (recommended for latest Vite and React stack)
4. Install dependencies:
```
npm install
```

### How to run in development
- Terminal 1:
```
npm run dev:back
```
- Terminal 2:
```
npm run dev:front
```
- Open the SPA at [http://localhost:5173](http://localhost:5173)

### Build and run in production
```
npm run build
npm run start
```

### SPA routes
- `/upload`: upload photos
- `/upload/confirmation`: confirmation page
- `/login`: authentication
- `/admin`: administration dashboard
- `/admin/moderation`: moderation grid
- `/admin/displayer`: slideshow
- `/admin/users/new`: create user
- `/admin/password`: change password

### How to use
- Open `/login`, log in with `admin` / `password`
- Change your password
- Open `/admin/displayer` in fullscreen on a video projector (pro-tip: press Enter to change the time between 2 photos)
- Open `/admin/moderation` to allow/deny submitted pictures (green border = displayed, red border = hidden, red cross = delete)
- Share the `/upload` page link with your guests