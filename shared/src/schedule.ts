// Slide schedules ("Happy hour, Mon-Fri 4-6 PM") evaluated in the venue's time zone.
// Pure functions: the server validates with them, the TV and phone views filter with them.

import type { Schedule, Weekday } from "./types.js";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "16:30" → 990 minutes after midnight, or null when malformed. */
export function parseTime(s: string | null | undefined): number | null {
  if (typeof s !== "string") return null;
  const m = TIME.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** True for a real IANA zone name this runtime knows. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    partsCache.set(tz, f);
  }
  return f;
}

/** Day of week and minutes after midnight at `now` in zone `tz` (falls back to UTC). */
export function localClock(now: number, tz: string): { day: Weekday; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatter(tz || "UTC").formatToParts(now);
  } catch {
    parts = formatter("UTC").formatToParts(now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = DAY_SHORT.indexOf(get("weekday") as (typeof DAY_SHORT)[number]);
  const hour = Number(get("hour")) % 24;
  return { day: (day < 0 ? 0 : day) as Weekday, minutes: hour * 60 + Number(get("minute")) };
}

/** Is a slide with this schedule on at `now`? A null schedule is always on. */
export function isScheduledNow(schedule: Schedule | null, now: number, tz: string): boolean {
  if (!schedule) return true;
  const { day, minutes } = localClock(now, tz);
  const days = new Set(schedule.days);
  const start = parseTime(schedule.start);
  const end = parseTime(schedule.end);
  if (start === null || end === null) return days.has(day);
  if (start === end) return days.has(day); // a full 24 hours starting on each listed day ≈ all day
  if (start < end) return days.has(day) && minutes >= start && minutes < end;
  // Overnight: the evening part on a listed day, the early-morning part the day after.
  const yesterday = ((day + 6) % 7) as Weekday;
  return (days.has(day) && minutes >= start) || (days.has(yesterday) && minutes < end);
}

/** Checks and normalizes a schedule from a request. Returns an error message for bad input. */
export function normalizeSchedule(input: unknown): { ok: true; value: Schedule | null } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "object") return { ok: false, error: "Schedule must be an object." };
  const s = input as Record<string, unknown>;
  if (!Array.isArray(s.days)) return { ok: false, error: "Pick at least one day." };
  const days = [...new Set(s.days)].filter((d): d is Weekday => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6);
  if (days.length !== s.days.length || days.length === 0) return { ok: false, error: "Pick at least one day." };
  days.sort((a, b) => a - b);
  const startRaw = s.start ?? null;
  const endRaw = s.end ?? null;
  if (startRaw === null && endRaw === null) return { ok: true, value: { days, start: null, end: null } };
  const start = parseTime(startRaw as string);
  const end = parseTime(endRaw as string);
  if (start === null || end === null) return { ok: false, error: "Enter both a start and an end time (HH:MM), or neither for all day." };
  if (start === end) return { ok: false, error: "The start and end times are the same." };
  return { ok: true, value: { days, start: startRaw as string, end: endRaw as string } };
}

/** "4:00 PM" from "16:00". */
export function formatTime12(hhmm: string): string {
  const mins = parseTime(hhmm);
  if (mins === null) return hhmm;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** "Mon–Fri", "Sat, Sun", "Every day", "Mon, Wed–Fri". */
export function formatDays(days: readonly Weekday[]): string {
  const set = new Set(days);
  if (set.size === 7) return "Every day";
  if (set.size === 0) return "Never";
  // Week starting Monday reads more naturally for bar hours.
  const order: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
  const runs: Weekday[][] = [];
  for (const d of order) {
    if (!set.has(d)) continue;
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev !== undefined && order.indexOf(prev) === order.indexOf(d) - 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) => (r.length >= 3 ? `${DAY_SHORT[r[0]]}–${DAY_SHORT[r[r.length - 1]]}` : r.map((d) => DAY_SHORT[d]).join(", ")))
    .join(", ");
}

/** "Mon–Fri 4–6 PM", "Sat, Sun", "Every day 10 PM – 2 AM". */
export function describeSchedule(s: Schedule | null): string {
  if (!s) return "Always";
  const days = formatDays(s.days);
  if (!s.start || !s.end) return days === "Every day" ? "Every day" : days;
  const a = formatTime12(s.start);
  const b = formatTime12(s.end);
  // "4 PM – 6 PM" → "4–6 PM" when both share the half of the day.
  const sameHalf = a.slice(-2) === b.slice(-2);
  const range = sameHalf ? `${a.slice(0, -3)}–${b}` : `${a} – ${b}`;
  return `${days} ${range}`;
}
