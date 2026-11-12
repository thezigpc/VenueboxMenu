// Bar Games: standalone stays standalone; on a (fake) box the venue's name, location,
// time zone and units are the defaults, and the admin's own choices still win.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { AdminState, Playlist } from "@menu/shared";
import { startApp, type TestApp } from "./helpers.js";

const TOKEN = "test-token";

describe("standalone", () => {
  let t: TestApp;
  before(async () => (t = await startApp({ gameName: "Kava Menu" })));
  after(() => t.stop());

  test("venue.json says standalone and the name is GAME_NAME", async () => {
    const v = (await (await t.get("/__bargames/venue.json")).json()) as { standalone: boolean };
    assert.equal(v.standalone, true);
    assert.deepEqual(await (await t.get("/api/config")).json(), { gameName: "Kava Menu" });
  });

  test("the admin's name setting wins standalone", async () => {
    const token = await t.login();
    await t.send("PUT", "/api/admin/settings", { name: "The Root Bar" }, token);
    assert.deepEqual(await (await t.get("/api/config")).json(), { gameName: "The Root Bar" });
    const s = (await (await t.get("/api/admin/state", token)).json()) as AdminState;
    assert.equal(s.venue, null);
  });

  test("gateway staff headers are ignored standalone", async () => {
    const staff = { "x-bargames-via": "1", "x-bargames-staff": "1" };
    const status = (await (await fetch(t.url + "/api/admin/status", { headers: staff })).json()) as { trusted: boolean };
    assert.equal(status.trusted, false);
    assert.equal((await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: staff })).status, 403);
  });

  test("status needs the box's token", async () => {
    assert.equal((await t.get("/__bargames/status")).status, 401);
  });
});

/** A fake box core serving a venue with a location, time zone and units. */
async function fakeCore(): Promise<{ url: string; close: () => Promise<void> }> {
  const srv = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401).end();
    if (req.url === "/internal/venue") {
      const theme = { colors: { background: "#0b2a2a", surface: "#12403f", text: "#f2fffd", primary: "#ff4fa3", accent: "#ffd23f" } };
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(
        JSON.stringify({
          protocol: 1,
          venue: {
            name: "Test Bar",
            theme,
            playUrl: "https://play.testbar.example",
            location: { latitude: 47.6062, longitude: -122.3321, label: "Seattle, WA" },
            timezone: "America/Los_Angeles",
            units: "metric",
          },
          game: { id: "menu", displayName: "Menu at Test Bar", theme },
          standalone: false,
          generatedAt: new Date().toISOString(),
        }),
      );
    }
    if (req.url === "/internal/events") return void res.writeHead(204).end();
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
    close: () => new Promise((r) => srv.close(() => r())),
  };
}

describe("on a box", () => {
  let core: Awaited<ReturnType<typeof fakeCore>>;
  let t: TestApp;
  before(async () => {
    core = await fakeCore();
    t = await startApp({ coreUrl: core.url, token: TOKEN, gameName: "Kava Menu" });
  });
  after(async () => {
    await t.stop();
    await core.close();
  });

  test("the venue's name for the module", async () => {
    assert.deepEqual(await (await t.get("/api/config")).json(), { gameName: "Menu at Test Bar" });
    assert.equal(((await (await t.get("/__bargames/venue.json")).json()) as { standalone: boolean }).standalone, false);
  });

  test("status lists no rooms", async () => {
    const r = await fetch(t.url + "/__bargames/status", { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.deepEqual(await r.json(), { rooms: [] });
  });

  test("weather defaults to the venue's location, zone and units", async () => {
    const p = (await (await t.get("/api/playlist")).json()) as Playlist;
    assert.equal(p.timezone, "America/Los_Angeles");
    assert.equal(p.weather?.data.label, "Seattle, WA");
    assert.equal(p.weather?.data.units, "metric");
    assert.ok(t.net.calls.some((u) => u.includes("latitude=47.6062") && u.includes("timezone=America%2FLos_Angeles")));
  });

  test("staff signed in to the box get an admin session without the password", async () => {
    const staff = { "x-bargames-via": "1", "x-bargames-staff": "1" };
    const status = (await (await fetch(t.url + "/api/admin/status", { headers: staff })).json()) as { trusted: boolean };
    assert.equal(status.trusted, true);
    const r = (await (await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: staff })).json()) as { token: string };
    assert.equal((await t.get("/api/admin/state", r.token)).status, 200);
    // Without the gateway's word (a guest, or a direct request) there's no shortcut.
    assert.equal((await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: { "x-bargames-staff": "1" } })).status, 403);
    assert.equal((await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: { "x-bargames-via": "1" } })).status, 403);
  });

  test("the admin's own choices override the venue's", async () => {
    const token = await t.login();
    const before = (await (await t.get("/api/admin/state", token)).json()) as AdminState;
    assert.deepEqual(before.venue, { location: { latitude: 47.6062, longitude: -122.3321, label: "Seattle, WA" }, timezone: "America/Los_Angeles", units: "metric" });
    await t.send("PUT", "/api/admin/settings", { timezone: "America/Denver", weather: { units: "imperial", location: { latitude: 39.74, longitude: -104.99, label: "Denver" } } }, token);
    const p = (await (await t.get("/api/playlist")).json()) as Playlist;
    assert.equal(p.timezone, "America/Denver");
    assert.equal(p.weather?.data.label, "Denver");
    assert.equal(p.weather?.data.units, "imperial");
  });
});
