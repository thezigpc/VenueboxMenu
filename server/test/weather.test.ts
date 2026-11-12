import { test } from "node:test";
import assert from "node:assert/strict";
import { FRESH_MS, forecastUrl, normalizeForecast, STALE_MS, WeatherService, type WeatherQuery } from "../src/weather.js";
import { fakeNet, sampleForecast } from "./helpers.js";

const q: WeatherQuery = { location: { latitude: 35.6, longitude: -82.55, label: "Asheville, NC" }, units: "imperial", timezone: "" };

test("the request asks for the venue's units and zone", () => {
  const u = new URL(forecastUrl(q));
  assert.equal(u.searchParams.get("temperature_unit"), "fahrenheit");
  assert.equal(u.searchParams.get("wind_speed_unit"), "mph");
  assert.equal(u.searchParams.get("timezone"), "auto");
  const metric = new URL(forecastUrl({ ...q, units: "metric", timezone: "Europe/Berlin" }));
  assert.equal(metric.searchParams.get("temperature_unit"), "celsius");
  assert.equal(metric.searchParams.get("timezone"), "Europe/Berlin");
});

test("a forecast is boiled down to now, the next hours and the days", () => {
  const w = normalizeForecast(sampleForecast(), q, Date.parse("2026-11-11T21:15:00Z"));
  assert.equal(w.label, "Asheville, NC");
  assert.equal(w.timezone, "America/New_York");
  assert.deepEqual(w.now, { temp: 61, feelsLike: 59, code: 2, isDay: true, wind: 8, humidity: 55 });
  // Current time is 16:15: the next hours start at 17:00.
  assert.deepEqual(
    w.hours.map((h) => h.time),
    ["2026-11-11T17:00", "2026-11-11T18:00", "2026-11-11T19:00", "2026-11-11T20:00", "2026-11-11T21:00", "2026-11-11T22:00"],
  );
  assert.equal(w.days.length, 4);
  assert.deepEqual(w.days[1], { date: "2026-11-12", high: 58, low: 45, code: 61, precipChance: 80 });
  assert.throws(() => normalizeForecast({ hourly: {} }, q));
});

test("cached for 15 minutes, then refreshed in the background", async () => {
  const net = fakeNet();
  let now = Date.parse("2026-11-11T21:15:00Z");
  const svc = new WeatherService(net.fetch, () => now);
  assert.ok(await svc.get(q));
  assert.ok(await svc.get(q));
  assert.equal(net.calls.length, 1);
  now += FRESH_MS + 1;
  assert.ok(await svc.get(q)); // the cached forecast comes back at once…
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(net.calls.length, 2); // …while a fresh one is fetched
});

test("a failed fetch keeps the last forecast for a while, then gives up quietly", async () => {
  const net = fakeNet();
  let now = Date.parse("2026-11-11T21:15:00Z");
  const svc = new WeatherService(net.fetch, () => now);
  assert.ok(await svc.get(q));
  net.failing = true;
  now += FRESH_MS + 1;
  assert.ok(await svc.get(q));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(svc.status(q).ok, false);
  now += STALE_MS;
  assert.equal(await svc.get(q), null); // too old: the TV skips the weather slide
});

test("no forecast at all when the first fetch fails", async () => {
  const net = fakeNet();
  net.failing = true;
  const svc = new WeatherService(net.fetch);
  assert.equal(await svc.get(q), null);
  assert.match(svc.status(q).message, /failed/);
});
