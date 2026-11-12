# Menu module: project notes

A slideshow for bar TVs: menu slides plus a weather slide on an interval. Staff upload
slides in its admin page; TVs show the slideshow full screen; guests read the same menu
on their phones. It runs **standalone** (its own server, like the user's other games) or
**on a Bar Games box** (installed from the box's Games tab, cast to the bar's TVs).

It is a **display module**, not a game: no rooms, no players, no join codes.

## Where things are
- The platform: `C:\CodeProjects\GameBroker` (repo thezigpc/venueplay). Its session owns
  the SDK and the box. **Don't edit that repo**; ask it (see "Talking to the box session").
- Integration guide for every game/module: `C:\CodeProjects\GameBroker\integration\README.md`,
  snippets in `integration\snippets\` (`publish-image.yml`, `useVenue.ts`, `bargames.ts`).
- Game kit: `C:\CodeProjects\GameKit` (README lists every helper). Don't edit it either.
- Vendored packages in `vendor/`: `bargames-sdk-0.5.0.tgz`, `bargames-gamekit-0.3.2.tgz`.
  Depend on them from each workspace as `"@bargames/sdk": "file:../vendor/bargames-sdk-0.5.0.tgz"`
  (same for the kit). SDK 0.5.0 has everything below (display modules, venue location).
- Models to copy from: `C:\CodeProjects\NoFilterGame` and `C:\CodeProjects\BingoDigitalGame`
  (both on the kit). Read, don't change.

## Conventions (same as the user's other games)
- npm workspaces (`shared`, `server`, `client`), TypeScript, Express 4, React 18 + Vite 5,
  Node 22 images. Tests with `node:test` (through tsx).
- Data under `DATA_DIR` (default `./data`, `/data` in the container); JSON stores and the
  admin password via the kit (`createJsonStore`, `createAdminAuth`, `adminRouter`).
  Uploaded images live in `DATA_DIR/slides/`.
- Dockerfile: multi-stage, `USER node`, `chown` the data dir (guide step "chown note").
  Image `ghcr.io/thezigpc/menu`, published by `.github/workflows/publish-image.yml` from
  the snippet. The first workflow run on a new repo has to be started by hand.
- Commit only when the user asks. No GitHub repo exists yet; the user creates it.
- Standalone must work with no box at all, and the SDK changes nothing off a box.

## What to build (v1: image slides + weather)
**Admin page** (`/admin`, password-protected via the kit):
- Upload JPG/PNG/WebP slides (drag and drop, several at once; cap ~20 MB each). Shrink
  anything bigger than 1920x1080 on upload (keeps TV pages light; the box re-encodes the
  screen to 1080p anyway).
- Reorder, hide/show, delete, per-slide duration (default from settings), optional
  schedule per slide: days of week + time window ("Happy hour, Mon-Fri 4-6 PM").
- Settings: default slide duration; transition (crossfade/none); weather on/off, every
  N minutes or every N slides, how long it shows; location (standalone; on a box the
  venue's location is the default) and units (°F/°C).
- Preview of the TV view.

**TV view** (`/tv`): full-screen 16:9, no cursor, crossfades, skips hidden/out-of-schedule
slides, picks up admin changes within a few seconds (poll or SSE, your call), keeps
running through network blips (keep the last good playlist). Empty playlist: a tasteful
"Menu coming soon" in the venue's theme.
- On a box: call the SDK's `tableMode(ctx)` (cursor, wake lock, shared-screen marker), show a
  small QR code in a corner to `ctx.venue.playUrl` ("Games & menu on your phone"), and show
  the staff announcement (`activeAnnouncement(ctx)`) as a TV-sized strip.
- Standalone: **no QR code**, no announcement.

**Phone view** (`/`, the landing page): the same slides as a scrolling menu (what's on
now first), the weather card if enabled, the venue theme. On a box, `<BackToGames />` at
the bottom and `<VenueAnnouncement />` at the top (from `@bargames/gamekit/client`).

**Weather slide:** Open-Meteo (free, no API key): now + the next few hours or 3 days.
Fetch on the **server**, cache 10-15 min, serve to the TV from the cache; if it fails,
skip the weather slide (never show an error on a TV). Times in the venue's time zone.

## The platform contract (SDK 0.5.0)
All of it is optional/additive; on a 0.4.0 box or standalone these fields are missing.
Full details: "Display modules" in the integration guide.

`bargames.json`:
```json
{
  "id": "menu", "name": "Menu", "kind": "display",
  "sdk": { "version": "0.5.0", "level": 1 },
  "routes": { "player": "/", "table": "/tv", "host": "/admin" },
  "network": { "internet": true }
}
```
(plus the usual `version`, `image`, `port`, `health`, `resources`: see the guide.)
- `kind: "display"`: the box leaves it out of the game lineup ("Also playing", the game
  cards) and lists it under its own heading on the games list; no room controls, no
  `sessionKinds` needed. `routes.table` is required (it's the TV view).
- `network.internet: true` is needed for the weather: game containers have no internet
  otherwise.
- Venue context (`useVenue()` / `ctx.venue`): `location?: { latitude, longitude, label? }`,
  `timezone?` (IANA, e.g. "America/New_York"), `units?: "imperial" | "metric"`,
  `modules?` (display modules on the box), `theme.colors.onPrimary?` (text on the primary
  color, CSS `--venue-on-primary`).
- Idle TVs: the box has a setting "Idle TVs show: box idle screen / Menu". With Menu, the
  box casts `routes.table` to TVs with nothing on, and a TV goes back to the menu when its
  game room closes. Staff can also cast the menu to a TV on purpose from the box's TVs page.
- `tableMode(ctx)` marks the page as a shared screen, so the SDK's announcement banner and
  the kit's `VenueAnnouncement` hide themselves there.
- The SDK's mock box (`npx bargames mock-box`) and `bargames check` understand display
  modules (no room checks).

**Order:** build it standalone first (slides, admin, weather, TV view, phone view, tests,
Dockerfile), then the box parts. Test the box parts with the SDK's mock box
(`npx bargames mock-box`, then `npx bargames check`): it gives a test venue location,
time zone and units, lists the module apart and casts its TV view without a room.

## Talking to the box session
The platform session (GameBroker) can be messaged with SendMessage; find it with
ListAgents (its name starts with `gamebroker`). Use it for contract questions or SDK
requests, not for code reviews of this repo. Session names change on every restart.
