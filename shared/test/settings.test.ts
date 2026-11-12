import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, mergeSettings, normalizeSlidePatch, settingsFromStored } from "../src/index.js";

test("partial updates keep everything else", () => {
  const r = mergeSettings(DEFAULT_SETTINGS, { defaultDurationSec: 12, weather: { units: "metric" } });
  assert.ok(r.ok);
  assert.equal(r.value.defaultDurationSec, 12);
  assert.equal(r.value.weather.units, "metric");
  assert.equal(r.value.weather.enabled, DEFAULT_SETTINGS.weather.enabled);
  assert.equal(r.value.transition, "crossfade");
});

test("bad values refuse the save", () => {
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { defaultDurationSec: 1 }).ok, false);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { transition: "spin" }).ok, false);
  for (const t of ["crossfade", "fade", "slide", "zoom", "none"]) assert.equal(mergeSettings(DEFAULT_SETTINGS, { transition: t }).ok, true);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { timezone: "Mars/Olympus" }).ok, false);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { weather: { location: { latitude: 100, longitude: 0 } } }).ok, false);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { weather: { mode: "slides", every: 500 } }).ok, false);
});

test("locations are rounded and labelled", () => {
  const r = mergeSettings(DEFAULT_SETTINGS, { weather: { location: { latitude: 35.59512345, longitude: -82.551234, label: " Asheville, NC " } } });
  assert.ok(r.ok);
  assert.deepEqual(r.value.weather.location, { latitude: 35.5951, longitude: -82.5512, label: "Asheville, NC" });
});

test("switching weather mode clamps the interval", () => {
  const r = mergeSettings({ ...DEFAULT_SETTINGS, weather: { ...DEFAULT_SETTINGS.weather, every: 200 } }, { weather: { mode: "slides" } });
  assert.ok(r.ok);
  assert.equal(r.value.weather.every, 100);
});

test("clock overlay options", () => {
  assert.deepEqual(DEFAULT_SETTINGS.overlay, { time: false, date: false, weather: false, position: "top-right", hour24: false });
  const r = mergeSettings(DEFAULT_SETTINGS, { overlay: { time: true, position: "bottom-left" } });
  assert.ok(r.ok);
  assert.deepEqual(r.value.overlay, { time: true, date: false, weather: false, position: "bottom-left", hour24: false });
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { overlay: { position: "middle" } }).ok, false);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { overlay: { time: "yes" } }).ok, false);
  // Settings saved before the clock existed load with it off.
  assert.deepEqual(settingsFromStored({ defaultDurationSec: 12 }).overlay, DEFAULT_SETTINGS.overlay);
});

test("a damaged settings file falls back to defaults", () => {
  assert.deepEqual(settingsFromStored(null), DEFAULT_SETTINGS);
  assert.deepEqual(settingsFromStored({ defaultDurationSec: "lots" }), DEFAULT_SETTINGS);
});

test("slide edits are validated", () => {
  assert.deepEqual(normalizeSlidePatch({ hidden: true, durationSec: null }), { ok: true, value: { hidden: true, durationSec: null } });
  assert.equal(normalizeSlidePatch({ durationSec: 0 }).ok, false);
  assert.deepEqual(normalizeSlidePatch({ transition: "zoom" }), { ok: true, value: { transition: "zoom" } });
  assert.deepEqual(normalizeSlidePatch({ transition: null }), { ok: true, value: { transition: null } });
  assert.equal(normalizeSlidePatch({ transition: "spin" }).ok, false);
  assert.equal(normalizeSlidePatch({ schedule: { days: [] } }).ok, false);
});
