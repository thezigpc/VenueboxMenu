# Menu

A slideshow for bar TVs: menu slides plus a weather slide on an interval, with a phone
view of the same menu. Runs standalone or on a Bar Games box (an app, not a
game: no rooms or players).

| Page | Path | What it is |
|---|---|---|
| Phone menu | `/` | The slides as a scrolling menu (what's on now first, then "Later" with times), the weather card |
| TV view | `/tv` | Full-screen 16:9 slideshow with transitions, scheduled slides and the weather slide |
| Admin | `/admin` | Password-protected: upload, order, hide, time, schedule and transition per slide; settings; live preview |

## Features
- **Uploads:** JPG/PNG/WebP, drag and drop, several at once, 20 MB each. Anything over
  1920x1080 is shrunk to fit, phone photos are turned upright, and camera metadata (GPS)
  is stripped.
- **Per slide:** order (drag or arrows), hide/show, seconds on screen, transition, and a
  schedule (days, plus an optional time window; overnight windows like 10 PM–2 AM work).
- **Transitions:** crossfade, fade through black, slide in, zoom, or none. Set a default,
  and override it per slide if you want.
- **Weather:** Open-Meteo (no API key), fetched by the server and cached for 15 minutes.
  Shows now plus the next 6 hours, or now plus the next 3 days. It comes up every N
  minutes or after every N slides. If a fetch fails, the last forecast stays up for
  3 hours; after that the weather slide is skipped (a TV never shows an error).
- **TV robustness:** polls every 5 s (an unchanged playlist is answered with a 304).
  Keeps the last good playlist through outages, also across reloads (localStorage).
  Skips images that won't load and reloads itself when the server is updated.
  "Menu coming soon" when nothing is on.
- **On a box:** the venue's name, theme, location, time zone and units. The TV calls
  `tableMode` and shows a QR code to the venue's games list and the staff announcement.
  The phone page shows the announcement and "← All games". Standalone, none of that
  appears.

## Develop
```bash
npm install
npm run dev        # server :3005 (tsx watch) + Vite :5175 (proxies /api, /slides)
npm test           # node:test through tsx: shared logic + server API (standalone and fake box)
npm run build      # shared, server, client
npm start          # node server/dist/index.js, serving client/dist
```
Open http://localhost:5175/admin and set the admin password (first run).

### Settings that come from the environment
| Var | Default | |
|---|---|---|
| `PORT` | 3005 | |
| `DATA_DIR` | `./data` (`/data` in the image) | `admin.json`, `settings.json`, `slides.json`, `slides/` |
| `ADMIN_PASSWORD` | (empty) | Set it to skip the first-run setup screen |
| `GAME_NAME` | `Menu` | Standalone name; the admin's "Name" setting wins over it |
| `TZ` | server's | Fallback time zone, used only when neither the admin setting nor the weather location gives one |

The time zone for schedules is chosen in this order: the admin's setting, the venue's
(on a box), the weather location's (from Open-Meteo), then the server's.

## Deploy standalone
```bash
cp .env.example .env    # optional
docker compose up -d --build   # 127.0.0.1:3006 → container 3005; put a tunnel in front
```
The image runs as uid 1000 on a read-only root filesystem. If root created `./data`
on the host, run `sudo chown -R 1000:1000 ./data` before the first start.

## Box
See [BARGAMES.md](BARGAMES.md). Image `ghcr.io/thezigpc/menu:<version>`, published by
`.github/workflows/publish-image.yml` whenever `bargames.json` changes on `main`.
