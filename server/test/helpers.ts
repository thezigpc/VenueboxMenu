// Test helpers: an in-process app on a free port with its own data dir, fake Open-Meteo,
// and images made on the fly.

import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp, type MenuApp } from "../src/app.js";
import { makeBarGames } from "../src/bargames.js";

export async function makeImage(width: number, height: number, format: "jpeg" | "png" | "webp" = "jpeg", opts: { exif?: boolean; orientation?: number } = {}): Promise<Buffer> {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  else if (opts.exif) img = img.withExifMerge({ IFD0: { Copyright: "test" } });
  return img.toFormat(format).toBuffer();
}

/** A sample Open-Meteo forecast response. */
export function sampleForecast(timezone = "America/New_York") {
  const hours = Array.from({ length: 48 }, (_, i) => `2026-11-11T${String(i % 24).padStart(2, "0")}:00`).map((t, i) =>
    i >= 24 ? t.replace("11T", "12T") : t,
  );
  return {
    timezone,
    current: { time: "2026-11-11T16:15", temperature_2m: 61.4, apparent_temperature: 59.2, relative_humidity_2m: 55, is_day: 1, weather_code: 2, wind_speed_10m: 7.6 },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 50 + (i % 24)),
      weather_code: hours.map(() => 3),
      precipitation_probability: hours.map(() => 10),
      is_day: hours.map((_, i) => (i % 24 >= 7 && i % 24 < 17 ? 1 : 0)),
    },
    daily: {
      time: ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"],
      weather_code: [2, 61, 3, 0],
      temperature_2m_max: [64.2, 58, 55, 60],
      temperature_2m_min: [45, 44.6, 40, 38],
      precipitation_probability_max: [10, 80, 20, 0],
    },
  };
}

export interface FakeNet {
  fetch: typeof fetch;
  calls: string[];
  /** Make Open-Meteo fail (true) or answer again (false). */
  failing: boolean;
}

export function fakeNet(): FakeNet {
  const net: FakeNet = {
    calls: [],
    failing: false,
    fetch: (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      net.calls.push(url);
      if (net.failing) throw new Error("network down");
      if (url.startsWith("https://api.open-meteo.com/")) {
        const tz = new URL(url).searchParams.get("timezone");
        return Response.json(sampleForecast(tz === "auto" ? "America/New_York" : (tz ?? "UTC")));
      }
      if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
        return Response.json({
          results: [{ name: "Asheville", latitude: 35.60095, longitude: -82.55402, admin1: "North Carolina", country_code: "US", country: "United States", timezone: "America/New_York" }],
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch,
  };
  return net;
}

export interface TestApp {
  url: string;
  menu: MenuApp;
  net: FakeNet;
  dataDir: string;
  /** fetch against the app, with JSON helpers. */
  get(path: string, token?: string): Promise<Response>;
  send(method: string, path: string, body: unknown, token?: string): Promise<Response>;
  upload(img: Buffer, name: string, token: string, type?: string): Promise<Response>;
  /** Sets the admin password up and returns a session token. */
  login(): Promise<string>;
  stop(): Promise<void>;
}

export async function startApp(
  opts: { coreUrl?: string; token?: string; adminPassword?: string; gameName?: string; clientDist?: string; basePath?: string } = {},
): Promise<TestApp> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "menu-test-"));
  const net = fakeNet();
  const bg = makeBarGames({ defaultName: opts.gameName || "Menu", coreUrl: opts.coreUrl ?? "", token: opts.token ?? "" });
  const menu = await createApp({
    dataDir,
    bg,
    adminPassword: opts.adminPassword,
    gameName: opts.gameName,
    clientDist: opts.clientDist,
    basePath: opts.basePath,
    fetch: net.fetch,
  });
  const server: Server = createServer(menu.app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});
  const t: TestApp = {
    url,
    menu,
    net,
    dataDir,
    get: (p, token) => fetch(url + p, { headers: auth(token) }),
    send: (method, p, body, token) =>
      body === null
        ? fetch(url + p, { method, headers: auth(token) })
        : fetch(url + p, { method, headers: { "content-type": "application/json", ...auth(token) }, body: JSON.stringify(body) }),
    upload: (img, name, token, type = "image/jpeg") =>
      fetch(url + "/api/admin/slides", {
        method: "POST",
        headers: { "content-type": type, "x-filename": encodeURIComponent(name), ...auth(token) },
        body: new Uint8Array(img),
      }),
    async login() {
      const r = await t.send("POST", "/api/admin/setup", { password: "correct horse battery" });
      const body = (await r.json()) as { ok: boolean; token?: string; error?: string };
      if (!body.token) throw new Error(`setup failed: ${body.error}`);
      return body.token;
    },
    async stop() {
      menu.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return t;
}
