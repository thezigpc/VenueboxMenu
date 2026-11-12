// The HTTP app: public playlist and slide images, the admin API, the built client.
// Built by a function so tests can run it in-process with their own data dir and fakes.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import express, { type Request, type Response } from "express";
import type { BarGames } from "@bargames/sdk/server";
import { adminRouter, createAdminAuth, createJsonStore, log, type AdminAuth } from "@bargames/gamekit/server";
import { DEFAULT_NAME, type AdminState, type Location, type Playlist, type Units } from "@menu/shared";
import { venueFacts, type VenueFacts } from "./bargames.js";
import { MAX_HEIGHT, MAX_UPLOAD_MB, MAX_WIDTH } from "./images.js";
import { MAX_SLIDES, MenuStore } from "./menuStore.js";
import { geocode, WeatherService, type WeatherQuery } from "./weather.js";

export interface AppOptions {
  dataDir: string;
  bg: BarGames;
  adminPassword?: string;
  /** GAME_NAME env (standalone default name). */
  gameName?: string;
  clientDist?: string;
  /** Outgoing HTTP (Open-Meteo); tests pass a fake. */
  fetch?: typeof fetch;
}

export interface MenuApp {
  app: express.Express;
  store: MenuStore;
  auth: AdminAuth;
  weather: WeatherService;
  close(): void;
}

const serverTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Async route errors go to Express instead of becoming unhandled rejections. */
const safe =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: (err?: unknown) => void) =>
    void fn(req, res).catch(next);

export async function createApp(o: AppOptions): Promise<MenuApp> {
  const fetchFn = o.fetch ?? fetch;
  const bg = o.bg;
  const store = new MenuStore(o.dataDir);
  await store.init();
  const weather = new WeatherService(fetchFn);

  const auth = createAdminAuth({
    store: createJsonStore(o.dataDir),
    envPassword: o.adminPassword ?? "",
    saltFormat: "bytes",
    // Standalone behind Cloudflare a whole venue's Wi-Fi shares one public IP, so a per-IP
    // lockout would let any guest lock the staff out; the kit's global cap and delay still
    // slow guessing. On a box each device has its own address.
    failsAllowed: bg.connected ? undefined : Number.POSITIVE_INFINITY,
    // On a box the venue box's admin password also opens this admin, even before the menu
    // has a password of its own (SDK 0.8.0). The box limits guesses; off a box it's false.
    venuePassword: (pw, ip) => bg.checkVenuePassword(pw, ip),
  });
  await auth.init();

  // The client build the server is serving: a TV left on for days reloads when it changes.
  const indexHtml = o.clientDist ? path.join(o.clientDist, "index.html") : "";
  const hasClient = !!indexHtml && existsSync(indexHtml);
  const build = hasClient ? createHash("sha1").update(readFileSync(indexHtml)).digest("hex").slice(0, 12) : "dev";

  /** Location, units and time zone after settings, then the venue's, then defaults. */
  async function effective(venue: VenueFacts | null) {
    const s = store.getSettings();
    const location: Location | null = s.weather.location ?? venue?.location ?? null;
    const units: Units = s.weather.units !== "auto" ? s.weather.units : (venue?.units ?? "imperial");
    const explicitTz = s.timezone || venue?.timezone || "";
    const query: WeatherQuery | null = location ? { location, units, timezone: explicitTz } : null;
    return { location, units, explicitTz, query };
  }

  const displayName = (venue: VenueFacts | null) => venue?.name ?? (store.getSettings().name || o.gameName || DEFAULT_NAME);

  async function playlist(): Promise<Playlist> {
    const venue = await venueFacts(bg);
    const s = store.getSettings();
    const eff = await effective(venue);
    const data = s.weather.enabled && eff.query ? await weather.get(eff.query) : null;
    const timezone = eff.explicitTz || data?.timezone || serverTimeZone();
    const body: Omit<Playlist, "version" | "serverTime"> = {
      build,
      name: displayName(venue),
      slides: store
        .getSlides()
        .filter((sl) => !sl.hidden)
        .map((sl) => ({
          id: sl.id,
          url: `/slides/${sl.file}`,
          width: sl.width,
          height: sl.height,
          title: sl.title,
          durationSec: sl.durationSec ?? s.defaultDurationSec,
          schedule: sl.schedule,
          transition: sl.transition ?? s.transition,
        })),
      defaultDurationSec: s.defaultDurationSec,
      transition: s.transition,
      timezone,
      weather: data
        ? { mode: s.weather.mode, every: s.weather.every, durationSec: s.weather.durationSec, forecast: s.weather.forecast, data }
        : null,
    };
    const version = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);
    return { ...body, version, serverTime: Date.now() };
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  // Bar Games: /__bargames/* (venue.json, theme.css, status). Before the SPA catch-all.
  app.use(bg.middleware());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, slides: store.getSlides().length });
  });

  app.get(
    "/api/config",
    safe(async (_req, res) => {
      res.set("Cache-Control", "no-cache");
      res.json({ gameName: displayName(await venueFacts(bg)) });
    }),
  );

  // TVs poll this every few seconds; an unchanged playlist costs a 304.
  app.get(
    "/api/playlist",
    safe(async (req, res) => {
      const p = await playlist();
      const etag = `W/"${p.version}"`;
      res.set("Cache-Control", "no-cache");
      res.set("ETag", etag);
      if (req.get("if-none-match") === etag) return void res.status(304).end();
      res.json(p);
    }),
  );

  // Slide images: named by a random id per upload, so they never change and cache forever.
  app.use(
    "/slides",
    express.static(store.slidesDir, {
      immutable: true,
      maxAge: "365d",
      index: false,
      dotfiles: "ignore",
      fallthrough: false,
      setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff"),
    }),
  );

  // ----------------------------------------------------------------- admin
  // Staff signed in to the venue box's admin get a session without the password (SDK 0.7.0).
  // isStaff trusts the gateway's headers only on a box, so standalone it's always false.
  const admin = adminRouter({ auth, clientIp: (req) => bg.clientIp(req), trusted: (req) => bg.isStaff(req) });

  admin.get(
    "/state",
    safe(async (_req, res) => {
      const venue = await venueFacts(bg);
      const eff = await effective(venue);
      const data = store.getSettings().weather.enabled && eff.query ? await weather.get(eff.query) : null;
      const body: AdminState = {
        slides: store.getSlides(),
        settings: store.getSettings(),
        venue: venue ? { location: venue.location, timezone: venue.timezone, units: venue.units } : null,
        effective: { timezone: eff.explicitTz || data?.timezone || serverTimeZone(), units: eff.units, location: eff.location },
        weatherStatus: store.getSettings().weather.enabled ? weather.status(eff.query) : { ok: false, message: "Weather is off.", fetchedAt: null },
        limits: { maxUploadMb: MAX_UPLOAD_MB, maxSlides: MAX_SLIDES, maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT },
      };
      res.json(body);
    }),
  );

  const rawImage = express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` });
  admin.post(
    "/slides",
    (req, res, next) =>
      rawImage(req, res, (err?: unknown) => {
        if (!err) return next();
        const tooBig = (err as { type?: string }).type === "entity.too.large";
        res.status(tooBig ? 413 : 400).json({ ok: false, error: tooBig ? `That file is over ${MAX_UPLOAD_MB} MB.` : "The upload didn't arrive in one piece. Try again." });
      }),
    safe(async (req, res) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return void res.status(400).json({ ok: false, error: "No image in the upload." });
      let title = "";
      try {
        title = decodeURIComponent(req.get("x-filename") ?? "");
      } catch {
        /* a malformed name just isn't used */
      }
      title = title.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ");
      const r = await store.addSlide(body, title);
      if (!r.ok) return void res.status(r.status ?? 400).json(r);
      res.json(r);
    }),
  );

  admin.patch(
    "/slides/:id",
    safe(async (req, res) => {
      const r = await store.updateSlide(String(req.params.id), req.body);
      res.status(r.ok ? 200 : (r.status ?? 400)).json(r);
    }),
  );

  admin.delete(
    "/slides/:id",
    safe(async (req, res) => {
      const r = await store.deleteSlide(String(req.params.id));
      res.status(r.ok ? 200 : (r.status ?? 400)).json(r);
    }),
  );

  admin.put(
    "/order",
    safe(async (req, res) => {
      const r = await store.reorder(req.body?.ids);
      res.status(r.ok ? 200 : (r.status ?? 400)).json(r);
    }),
  );

  admin.put(
    "/settings",
    safe(async (req, res) => {
      const r = await store.updateSettings(req.body);
      if (r.ok) log.info("admin", "settings saved");
      res.status(r.ok ? 200 : 400).json(r);
    }),
  );

  admin.get(
    "/geocode",
    safe(async (req, res) => {
      const q = String(req.query.q ?? "").trim();
      if (q.length < 2 || q.length > 80) return void res.status(400).json({ ok: false, error: "Type a town or city." });
      try {
        res.json({ ok: true, results: await geocode(q, fetchFn) });
      } catch (err) {
        log.warn("weather", "place search failed", { err: String(err) });
        res.status(502).json({ ok: false, error: "The place search isn't answering. Enter latitude and longitude instead." });
      }
    }),
  );

  app.use("/api/admin", admin);
  app.use("/api", (_req, res) => void res.status(404).json({ ok: false, error: "Not found." }));

  // ----------------------------------------------------------------- client
  if (hasClient && o.clientDist) {
    app.use(express.static(o.clientDist, { index: false, maxAge: "1h" }));
    app.get("*", (_req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(indexHtml);
    });
  } else {
    log.warn("boot", "client build not found; serving the API only", { path: o.clientDist });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: (e?: unknown) => void) => {
    const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) log.error("http", "request failed", { err: String(err) });
    if (!res.headersSent) res.status(status).json({ ok: false, error: status === 404 ? "Not found." : "Something went wrong." });
  });

  return { app, store, auth, weather, close: () => auth.close() };
}
