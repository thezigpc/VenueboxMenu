import { test } from "node:test";
import assert from "node:assert/strict";
import { initialRotation, nextItem, type Playlist, type PublicSlide, type ShowItem } from "../src/index.js";

const slide = (id: string, extra: Partial<PublicSlide> = {}): PublicSlide => ({
  id,
  url: `/slides/${id}.jpg`,
  width: 1920,
  height: 1080,
  title: id,
  durationSec: 10,
  schedule: null,
  transition: "crossfade",
  ...extra,
});

type P = Pick<Playlist, "slides" | "timezone" | "weather" | "defaultDurationSec">;
const weather = (mode: "minutes" | "slides", every: number) =>
  ({ mode, every, durationSec: 15, forecast: "hours", data: {} }) as unknown as Playlist["weather"];

/** Runs the rotation for n steps, advancing the clock by each item's duration. */
function run(p: P | ((i: number) => P), n: number, start = Date.parse("2026-11-11T18:00:00Z")) {
  let state = initialRotation(start);
  let now = start;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = nextItem(state, typeof p === "function" ? p(i) : p, now);
    state = r.state;
    now += r.item.durationMs;
    out.push(label(r.item));
  }
  return out;
}
const label = (it: ShowItem) => (it.kind === "slide" ? it.slide.id : it.kind);

test("slides loop in order", () => {
  const p: P = { slides: [slide("a"), slide("b"), slide("c")], timezone: "UTC", weather: null, defaultDurationSec: 10 };
  assert.deepEqual(run(p, 7), ["a", "b", "c", "a", "b", "c", "a"]);
});

test("weather after every N slides, never twice in a row", () => {
  const p: P = { slides: [slide("a"), slide("b"), slide("c")], timezone: "UTC", weather: weather("slides", 2), defaultDurationSec: 10 };
  assert.deepEqual(run(p, 8), ["a", "b", "weather", "c", "a", "weather", "b", "c"]);
});

test("weather every N minutes", () => {
  // 10 s slides, weather every minute: six slides fit before it's due.
  const p: P = { slides: [slide("a"), slide("b")], timezone: "UTC", weather: weather("minutes", 1), defaultDurationSec: 10 };
  const seq = run(p, 9);
  assert.deepEqual(seq, ["a", "b", "a", "b", "a", "b", "weather", "a", "b"]);
});

test("out-of-schedule slides are skipped", () => {
  // Never on: a schedule for a day that isn't today (2026-11-11 is a Wednesday).
  const p: P = {
    slides: [slide("a"), slide("brunch", { schedule: { days: [0], start: null, end: null } }), slide("c")],
    timezone: "UTC",
    weather: null,
    defaultDurationSec: 10,
  };
  assert.deepEqual(run(p, 4), ["a", "c", "a", "c"]);
});

test("nothing on: 'coming soon', with the weather still taking its turn", () => {
  const empty: P = { slides: [], timezone: "UTC", weather: null, defaultDurationSec: 10 };
  assert.deepEqual(run(empty, 2), ["empty", "empty"]);
  const withWeather: P = { ...empty, weather: weather("slides", 1) };
  assert.deepEqual(run(withWeather, 4), ["empty", "weather", "empty", "weather"]);
});

test("keeps its place when the playlist changes under it", () => {
  const before = [slide("a"), slide("b"), slide("c"), slide("d")];
  const afterDelete = [slide("a"), slide("c"), slide("d")]; // b deleted while it was on screen
  const seq = run((i) => ({ slides: i < 2 ? before : afterDelete, timezone: "UTC", weather: null, defaultDurationSec: 10 }), 4);
  assert.deepEqual(seq, ["a", "b", "c", "d"]);
});

test("each slide's own duration is used", () => {
  const p: P = { slides: [slide("a", { durationSec: 30 })], timezone: "UTC", weather: null, defaultDurationSec: 10 };
  const r = nextItem(initialRotation(0), p, 0);
  assert.equal(r.item.durationMs, 30_000);
});
