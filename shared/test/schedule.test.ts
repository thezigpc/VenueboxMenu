import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSchedule, isScheduledNow, localClock, normalizeSchedule, type Schedule } from "../src/index.js";

const NY = "America/New_York";
// 2026-11-11 is a Wednesday. New York is UTC-5 in November.
const at = (iso: string) => Date.parse(iso);

test("localClock reads the day and time in the venue's zone", () => {
  assert.deepEqual(localClock(at("2026-11-11T21:30:00Z"), NY), { day: 3, minutes: 16 * 60 + 30 });
  // 02:00 UTC Thursday is still Wednesday evening in New York.
  assert.deepEqual(localClock(at("2026-11-12T02:00:00Z"), NY), { day: 3, minutes: 21 * 60 });
  assert.deepEqual(localClock(at("2026-11-12T02:00:00Z"), "UTC"), { day: 4, minutes: 120 });
});

test("a null schedule is always on", () => {
  assert.equal(isScheduledNow(null, Date.now(), NY), true);
});

test("happy hour Mon-Fri 4-6 PM", () => {
  const s: Schedule = { days: [1, 2, 3, 4, 5], start: "16:00", end: "18:00" };
  assert.equal(isScheduledNow(s, at("2026-11-11T20:59:00Z"), NY), false); // Wed 3:59 PM
  assert.equal(isScheduledNow(s, at("2026-11-11T21:00:00Z"), NY), true); // Wed 4:00 PM
  assert.equal(isScheduledNow(s, at("2026-11-11T22:59:00Z"), NY), true); // Wed 5:59 PM
  assert.equal(isScheduledNow(s, at("2026-11-11T23:00:00Z"), NY), false); // Wed 6:00 PM (end is exclusive)
  assert.equal(isScheduledNow(s, at("2026-11-14T21:30:00Z"), NY), false); // Sat 4:30 PM
});

test("all day on chosen days", () => {
  const weekend: Schedule = { days: [0, 6], start: null, end: null };
  assert.equal(isScheduledNow(weekend, at("2026-11-14T15:00:00Z"), NY), true); // Sat
  assert.equal(isScheduledNow(weekend, at("2026-11-11T15:00:00Z"), NY), false); // Wed
});

test("overnight windows run into the next morning", () => {
  const late: Schedule = { days: [5], start: "22:00", end: "02:00" }; // Friday late night
  assert.equal(isScheduledNow(late, at("2026-11-14T03:30:00Z"), NY), true); // Fri 10:30 PM
  assert.equal(isScheduledNow(late, at("2026-11-14T06:30:00Z"), NY), true); // Sat 1:30 AM
  assert.equal(isScheduledNow(late, at("2026-11-14T07:30:00Z"), NY), false); // Sat 2:30 AM
  assert.equal(isScheduledNow(late, at("2026-11-13T06:30:00Z"), NY), false); // Fri 1:30 AM (Thursday night isn't listed)
});

test("normalizeSchedule validates input", () => {
  assert.deepEqual(normalizeSchedule(null), { ok: true, value: null });
  assert.deepEqual(normalizeSchedule({ days: [5, 1, 3], start: "16:00", end: "18:00" }), {
    ok: true,
    value: { days: [1, 3, 5], start: "16:00", end: "18:00" },
  });
  assert.deepEqual(normalizeSchedule({ days: [6] }), { ok: true, value: { days: [6], start: null, end: null } });
  assert.equal(normalizeSchedule({ days: [] }).ok, false);
  assert.equal(normalizeSchedule({ days: [7] }).ok, false);
  assert.equal(normalizeSchedule({ days: [1], start: "16:00" }).ok, false);
  assert.equal(normalizeSchedule({ days: [1], start: "4pm", end: "6pm" }).ok, false);
  assert.equal(normalizeSchedule({ days: [1], start: "16:00", end: "16:00" }).ok, false);
});

test("describeSchedule reads like a menu board", () => {
  assert.equal(describeSchedule(null), "Always");
  assert.equal(describeSchedule({ days: [1, 2, 3, 4, 5], start: "16:00", end: "18:00" }), "Mon–Fri 4–6 PM");
  assert.equal(describeSchedule({ days: [0, 6], start: null, end: null }), "Sat, Sun");
  assert.equal(describeSchedule({ days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "02:00" }), "Every day 10 PM – 2 AM");
  assert.equal(describeSchedule({ days: [1, 3, 4, 5], start: "11:30", end: "14:00" }), "Mon, Wed–Fri 11:30 AM – 2 PM");
});
