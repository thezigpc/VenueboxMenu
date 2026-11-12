import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AdminState, Playlist, Slide } from "@menu/shared";
import { makeImage, startApp, type TestApp } from "./helpers.js";

describe("admin and playlist", () => {
  let t: TestApp;
  let token: string;
  before(async () => {
    t = await startApp();
    token = await t.login();
  });
  after(() => t.stop());

  const playlist = async () => (await (await t.get("/api/playlist")).json()) as Playlist;
  const state = async () => (await (await t.get("/api/admin/state", token)).json()) as AdminState;

  test("admin routes need a session", async () => {
    assert.equal((await t.get("/api/admin/state")).status, 401);
    assert.equal((await t.upload(await makeImage(100, 100), "x.jpg", "nope")).status, 401);
    assert.equal((await t.send("PUT", "/api/admin/settings", { defaultDurationSec: 5 })).status, 401);
  });

  test("an empty menu", async () => {
    const p = await playlist();
    assert.deepEqual(p.slides, []);
    assert.equal(p.weather, null); // no location standalone until the staff set one
    assert.equal(p.name, "Menu");
  });

  test("upload, then the slide is on the playlist and its image is served", async () => {
    const r = await t.upload(await makeImage(3000, 2000), "Happy_hour-specials.jpg", token);
    assert.equal(r.status, 200);
    const { value: slide } = (await r.json()) as { value: Slide };
    assert.equal(slide.title, "Happy hour specials");
    assert.deepEqual([slide.width, slide.height], [1620, 1080]);
    assert.ok(existsSync(path.join(t.dataDir, "slides", slide.file)));

    const p = await playlist();
    assert.equal(p.slides.length, 1);
    assert.equal(p.slides[0].durationSec, 10); // the default
    const img = await t.get(p.slides[0].url);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/jpeg");
    assert.match(img.headers.get("cache-control") ?? "", /immutable/);
  });

  test("bad uploads are refused with a reason", async () => {
    const r = await t.upload(Buffer.from("not an image"), "notes.txt", token, "text/plain");
    assert.equal(r.status, 415);
    assert.match(((await r.json()) as { error: string }).error, /image/);
    const big = await t.upload(Buffer.alloc(21 * 1024 * 1024), "huge.jpg", token);
    assert.equal(big.status, 413);
  });

  test("the playlist answers 304 until something changes", async () => {
    const first = await t.get("/api/playlist");
    const etag = first.headers.get("etag")!;
    const again = await fetch(t.url + "/api/playlist", { headers: { "if-none-match": etag } });
    assert.equal(again.status, 304);
    await t.send("PUT", "/api/admin/settings", { defaultDurationSec: 8 }, token);
    const changed = await fetch(t.url + "/api/playlist", { headers: { "if-none-match": etag } });
    assert.equal(changed.status, 200);
    assert.equal(((await changed.json()) as Playlist).slides[0].durationSec, 8);
  });

  test("hide, schedule, per-slide time, reorder, delete", async () => {
    await t.upload(await makeImage(800, 450, "png"), "Second.png", token, "image/png");
    await t.upload(await makeImage(800, 450, "webp"), "Third.webp", token, "image/webp");
    let s = await state();
    assert.equal(s.slides.length, 3);
    const [a, b, c] = s.slides;

    // Hidden slides never reach the public playlist.
    assert.equal((await t.send("PATCH", `/api/admin/slides/${b.id}`, { hidden: true }, token)).status, 200);
    assert.deepEqual((await playlist()).slides.map((x) => x.id), [a.id, c.id]);

    // A schedule and a time of its own travel with the slide.
    const sched = { days: [1, 2, 3, 4, 5], start: "16:00", end: "18:00" };
    assert.equal((await t.send("PATCH", `/api/admin/slides/${c.id}`, { schedule: sched, durationSec: 20 }, token)).status, 200);
    const pc = (await playlist()).slides.find((x) => x.id === c.id)!;
    assert.deepEqual(pc.schedule, sched);
    assert.equal(pc.durationSec, 20);
    assert.equal(pc.transition, "crossfade"); // the default until the slide picks its own
    assert.equal((await t.send("PATCH", `/api/admin/slides/${c.id}`, { transition: "zoom" }, token)).status, 200);
    assert.equal((await playlist()).slides.find((x) => x.id === c.id)!.transition, "zoom");
    assert.equal((await t.send("PATCH", `/api/admin/slides/${c.id}`, { schedule: { days: [] } }, token)).status, 400);

    // Reorder must name every slide.
    assert.equal((await t.send("PUT", "/api/admin/order", { ids: [c.id, a.id] }, token)).status, 409);
    assert.equal((await t.send("PUT", "/api/admin/order", { ids: [c.id, b.id, a.id] }, token)).status, 200);
    s = await state();
    assert.deepEqual(s.slides.map((x) => x.id), [c.id, b.id, a.id]);

    // Delete removes the image too.
    assert.equal((await t.send("DELETE", `/api/admin/slides/${a.id}`, null, token)).status, 200);
    assert.equal(existsSync(path.join(t.dataDir, "slides", a.file)), false);
    assert.equal((await t.get(`/slides/${a.file}`)).status, 404);
    assert.equal((await t.send("DELETE", `/api/admin/slides/${a.id}`, null, token)).status, 404);
  });

  test("weather appears once a location is set, in the right zone", async () => {
    const r = await t.send("PUT", "/api/admin/settings", { weather: { location: { latitude: 35.6, longitude: -82.55, label: "Asheville, NC" } } }, token);
    assert.equal(r.status, 200);
    const p = await playlist();
    assert.ok(p.weather);
    assert.equal(p.weather.data.label, "Asheville, NC");
    assert.equal(p.weather.data.units, "imperial");
    assert.equal(p.timezone, "America/New_York"); // from the location when no zone is set
    const s = await state();
    assert.equal(s.weatherStatus.ok, true);
    assert.equal(s.effective.timezone, "America/New_York");

    await t.send("PUT", "/api/admin/settings", { timezone: "America/Chicago", weather: { units: "metric" } }, token);
    const p2 = await playlist();
    assert.equal(p2.timezone, "America/Chicago");
    assert.equal(p2.weather?.data.units, "metric");
    assert.ok(t.net.calls.some((u) => u.includes("timezone=America%2FChicago") && u.includes("celsius")));

    await t.send("PUT", "/api/admin/settings", { weather: { enabled: false } }, token);
    assert.equal((await playlist()).weather, null);
  });

  test("weather that can't be fetched just isn't shown", async () => {
    await t.send("PUT", "/api/admin/settings", { weather: { enabled: true, location: { latitude: 10, longitude: 10 } } }, token);
    t.net.failing = true;
    try {
      const r = await t.get("/api/playlist");
      assert.equal(r.status, 200);
      assert.equal(((await r.json()) as Playlist).weather, null);
    } finally {
      t.net.failing = false;
    }
  });

  test("place search", async () => {
    const r = await t.get("/api/admin/geocode?q=asheville", token);
    const body = (await r.json()) as { results: { label: string; timezone: string }[] };
    assert.equal(body.results[0].label, "Asheville, North Carolina");
    assert.equal(body.results[0].timezone, "America/New_York");
    assert.equal((await t.get("/api/admin/geocode?q=a", token)).status, 400);
  });

  test("settings survive a restart", async () => {
    const s = await state();
    assert.equal(s.settings.defaultDurationSec, 8);
    assert.equal(s.settings.timezone, "America/Chicago");
    const again = await import("../src/menuStore.js").then(async ({ MenuStore }) => {
      const store = new MenuStore(t.dataDir);
      await store.init();
      return store;
    });
    assert.deepEqual(again.getSettings(), s.settings);
    assert.deepEqual(again.getSlides(), s.slides);
  });
});

test("ADMIN_PASSWORD closes the setup screen", async () => {
  const t = await startApp({ adminPassword: "from-env-password" });
  try {
    const status = (await (await t.get("/api/admin/status")).json()) as { setupNeeded: boolean; configured: boolean };
    assert.deepEqual([status.setupNeeded, status.configured], [false, true]);
    assert.equal((await t.send("POST", "/api/admin/login", { password: "wrong" })).status, 401);
    const ok = (await (await t.send("POST", "/api/admin/login", { password: "from-env-password" })).json()) as { token: string };
    assert.equal((await t.get("/api/admin/state", ok.token)).status, 200);
  } finally {
    await t.stop();
  }
});
