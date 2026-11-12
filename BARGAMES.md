# Bar Games integration: Menu (app)

**Level 1, `kind: "app"`, SDK 0.8.0, game kit 0.5.1.** An app (formerly "display module") has no rooms, players, events or
commands. What it takes from the box is the venue's name, theme, location, time zone,
units, games-list address and announcement.

## Manifest
`bargames.json`: id `menu`, `kind: "app"`, port 3005, routes `/` (phone), `/tv`
(TV), `/admin` (host), `network.internet: true` (Open-Meteo), `env.DATA_DIR=/data`,
256m. `events` and `commands` are empty. `npx bargames validate .` passes (with the
expected "not pinned by digest" warning).

## `npx bargames check` (SDK 0.8.0 mock box, server on a spare port)
```
menu@0.4.0 · level 1 · http://127.0.0.1:3106
✓ health /health → 200
✓ /__bargames/venue.json returns the box's branding ("Menu (mock)")
✓ /__bargames/theme.css served
✓ phone page (routes.player) / → 200
✓ TV view (routes.table) /tv → 200

all checks passed
```
On Windows with Node 24, the CLI then prints `Assertion failed: !(handle->flags &
UV_HANDLE_CLOSING) … async.c` as it exits. That is a libuv quirk on process exit, after
the result.

Checked by hand through the mock gateway (`--announce`). The mock lists the menu in `venue.apps`:
- TV: mock theme; `<html data-bargames-screen="shared">`; the announcement strip; the QR
  code to `venue.playUrl`; pointer hidden.
- Phone: mock theme; the kit's `VenueAnnouncement` at the top; `BackToGames` with "Also
  playing" at the bottom.
- No console errors.

## Server (`server/src/bargames.ts`, `server/src/app.ts`)
- `createBarGames({ gameId: "menu" })`. The middleware is mounted before `/api`, the
  static files and the SPA catch-all. The status provider returns `{ rooms: [] }`.
- `/api/config` → `gameName`. On a box that's the venue's display name; standalone it's
  the admin's name setting, then `GAME_NAME`, then "Menu".
- `venueFacts()` reads `venue.location`, `venue.timezone` and `venue.units`. These are
  the defaults for the weather and schedules; the admin's own settings override them.
  If the box can't be reached, the SDK falls back to its last context.
- Staff sign-in (SDK 0.7.0): `routes.admin` is `/admin`, and the kit's `adminRouter`
  gets `trusted: (req) => bg.isStaff(req)`. The admin page calls `staffSignIn()` before
  the password form. Staff who open the menu's settings from the box admin go straight
  in. `isStaff` trusts the gateway's headers only on a box, so standalone is unchanged
  (tested both ways in `server/test/bargames.test.ts`). Checked in a browser on the mock
  box: `/__bargames/staff?next=/admin` opens the admin without the password, and
  `?off=1` brings the form back.
- The box's admin password (SDK 0.8.0): `createAdminAuth({ venuePassword: (pw, ip) =>
  bg.checkVenuePassword(pw, ip) })`. It works on the menu's login, even before the menu
  has a password of its own. With `onBox: bg.connected` (kit 0.5.1) the box's password
  takes over: `/api/admin/status` says `venueLogin`, so the admin page shows the box
  sign-in form first. A separate menu password can be set only when `setupAllowed`
  (the box vouches for staff), and `/api/admin/setup` refuses guests, so nobody on the
  venue Wi-Fi can claim the menu. The box limits guesses; standalone it's always
  refused, and the first-run setup screen works as before. Tested with a fake core, and in a browser on
  the mock box (`box-password`).
- Admin login uses the kit's `adminRouter` and `clientIp` (`bg.clientIp`). Per-IP
  lockout is off standalone (behind Cloudflare, a whole venue shares one IP) and on
  with a box.

## TV view (`/tv`, `client/src/pages/TvPage.tsx`): step 7 checklist
- [x] The URL alone shows the slideshow: no prompt, no gesture.
- [x] No audio.
- [x] Fills 1920×1080 with no scrolling. Slides use `object-fit: contain`, and overlay
  text scales off the 16:9 height (QR caption about 2.6vh, announcement about 4.6vh,
  weather 3–24vh) within the `--bg-safe-*` margins.
- [x] Recovers on its own:
  - polls `/api/playlist` every 5 s, backing off to at most 60 s while the server is
    unreachable;
  - keeps the last good playlist, in memory and in localStorage;
  - if images won't load, keeps the current slide on screen rather than blanking;
  - reloads when the server's client build changes;
  - after a render crash, reloads after 10 s.
- [x] Light animation: one transition per slide change (1–1.2 s, or none), static
  otherwise.
- [x] Nothing needs a pointer. `tableMode(ctx)` is on with a box. Standalone it uses its
  own wake lock and `cursor: none`.
- The announcement is drawn by the module itself (`activeAnnouncement`), without the
  `bargames-announcement` class, so the shared-screen CSS doesn't hide it.

## Container
- Writes only under `/data`: `admin.json`, `settings.json`, `slides.json`,
  `slides/<id>.<ext>`.
- Multi-stage `Dockerfile`, `USER node`, `/data` chowned.
- Tested on a Linux Docker host (2026-11-11, throwaway build, removed afterwards):
  - `docker build --platform linux/amd64 .` from the source tree, with no `node_modules`
    or `dist`: OK, 390 MB.
  - `docker run --read-only --tmpfs /tmp --cap-drop ALL --memory 256m -v vol:/data`:
    started; `/health` answered.
  - An 18 MB, 24-megapixel JPEG upload was shrunk to 1620×1080. Memory afterwards was
    88 MiB; no OOM.
  - Writing to `/app` fails (read-only); the process runs as uid 1000.

## Standalone
Everything box-only is behind `bg.connected` (server) or `isOnBox(ctx)` (client). Tests
in `server/test/bargames.test.ts` check standalone behavior:
- `venue.json` says `standalone: true`;
- the name comes from `GAME_NAME` or the admin setting;
- the admin state shows no venue;
- `status` needs the token.

They also run it against a fake box core. The venue's location, zone and units become the
defaults, and the admin's own choices override them.

## Image
- `ghcr.io/thezigpc/menu:<version>` (0.4.0 is on SDK 0.8.0, kit 0.5.1), published by `.github/workflows/publish-image.yml`
  (copied unchanged from the snippet).
- Repo: https://github.com/thezigpc/VenueboxMenu (public). The package is public too; an
  anonymous pull of 0.1.0 returned 200. The workflow's build on GitHub is the
  clean-checkout build.

## SDK requests
- None blocking.
- Nice to have: a `tableMode` option to leave out the "Reconnecting…" strip, or
  guidance for apps on it. The menu doesn't call `setState`, so a TV keeps
  showing the last playlist during an outage.
