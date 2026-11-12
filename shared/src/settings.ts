// Settings defaults and validation (the server checks every save with these).

import { isValidTimeZone, normalizeSchedule } from "./schedule.js";
import type { Location, Settings, Slide, Transition } from "./types.js";

export const TRANSITIONS: readonly { id: Transition; label: string }[] = [
  { id: "crossfade", label: "Crossfade" },
  { id: "fade", label: "Fade through black" },
  { id: "slide", label: "Slide in" },
  { id: "zoom", label: "Zoom" },
  { id: "none", label: "None (cut)" },
];
export const isTransition = (v: unknown): v is Transition => TRANSITIONS.some((t) => t.id === v);

export const DEFAULT_SETTINGS: Settings = {
  name: "",
  defaultDurationSec: 10,
  transition: "crossfade",
  timezone: "",
  weather: {
    enabled: true,
    mode: "minutes",
    every: 10,
    durationSec: 15,
    forecast: "hours",
    location: null,
    units: "auto",
  },
};

export const LIMITS = {
  durationSec: [3, 600] as const,
  weatherEveryMinutes: [1, 240] as const,
  weatherEverySlides: [1, 100] as const,
  weatherDurationSec: [5, 120] as const,
  nameLength: 60,
  titleLength: 80,
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const intIn = (v: unknown, [lo, hi]: readonly [number, number]): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

export function normalizeLocation(v: unknown): Result<Location | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "object") return { ok: false, error: "Location must be latitude and longitude." };
  const o = v as Record<string, unknown>;
  const lat = Number(o.latitude);
  const lon = Number(o.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { ok: false, error: "Latitude must be between -90 and 90, longitude between -180 and 180." };
  }
  const label = typeof o.label === "string" ? o.label.trim().slice(0, 80) : "";
  return { ok: true, value: { latitude: Math.round(lat * 1e4) / 1e4, longitude: Math.round(lon * 1e4) / 1e4, ...(label ? { label } : {}) } };
}

/** Applies a partial update to settings. Unknown fields are ignored; bad values refuse the whole save. */
export function mergeSettings(current: Settings, patch: unknown): Result<Settings> {
  if (!patch || typeof patch !== "object") return { ok: false, error: "Nothing to save." };
  const p = patch as Record<string, unknown>;
  const next: Settings = { ...current, weather: { ...current.weather } };

  if ("name" in p) {
    if (typeof p.name !== "string") return { ok: false, error: "Name must be text." };
    next.name = p.name.trim().slice(0, LIMITS.nameLength);
  }
  if ("defaultDurationSec" in p) {
    const v = intIn(p.defaultDurationSec, LIMITS.durationSec);
    if (v === null) return { ok: false, error: `Slide time must be ${LIMITS.durationSec[0]}–${LIMITS.durationSec[1]} seconds.` };
    next.defaultDurationSec = v;
  }
  if ("transition" in p) {
    if (!isTransition(p.transition)) return { ok: false, error: "Unknown transition." };
    next.transition = p.transition;
  }
  if ("timezone" in p) {
    if (typeof p.timezone !== "string" || (p.timezone !== "" && !isValidTimeZone(p.timezone))) {
      return { ok: false, error: "That isn't a time zone this server knows (e.g. America/New_York)." };
    }
    next.timezone = p.timezone;
  }
  if ("weather" in p) {
    if (!p.weather || typeof p.weather !== "object") return { ok: false, error: "Bad weather settings." };
    const w = p.weather as Record<string, unknown>;
    const nw = next.weather;
    if ("enabled" in w) {
      if (typeof w.enabled !== "boolean") return { ok: false, error: "Weather on/off must be true or false." };
      nw.enabled = w.enabled;
    }
    if ("mode" in w) {
      if (w.mode !== "minutes" && w.mode !== "slides") return { ok: false, error: "Weather timing must be minutes or slides." };
      nw.mode = w.mode;
    }
    if ("every" in w) {
      const range = nw.mode === "minutes" ? LIMITS.weatherEveryMinutes : LIMITS.weatherEverySlides;
      const v = intIn(w.every, range);
      if (v === null) return { ok: false, error: `Show the weather every ${range[0]}–${range[1]} ${nw.mode}.` };
      nw.every = v;
    } else if ("mode" in w) {
      // Switching mode keeps a number that makes sense for the new mode.
      const range = nw.mode === "minutes" ? LIMITS.weatherEveryMinutes : LIMITS.weatherEverySlides;
      nw.every = Math.min(range[1], Math.max(range[0], nw.every));
    }
    if ("durationSec" in w) {
      const v = intIn(w.durationSec, LIMITS.weatherDurationSec);
      if (v === null) return { ok: false, error: `Weather time must be ${LIMITS.weatherDurationSec[0]}–${LIMITS.weatherDurationSec[1]} seconds.` };
      nw.durationSec = v;
    }
    if ("forecast" in w) {
      if (w.forecast !== "hours" && w.forecast !== "days") return { ok: false, error: "Forecast must be hours or days." };
      nw.forecast = w.forecast;
    }
    if ("location" in w) {
      const r = normalizeLocation(w.location);
      if (!r.ok) return r;
      nw.location = r.value;
    }
    if ("units" in w) {
      if (w.units !== "auto" && w.units !== "imperial" && w.units !== "metric") return { ok: false, error: "Units must be auto, imperial or metric." };
      nw.units = w.units;
    }
  }
  return { ok: true, value: next };
}

/** Reads settings from disk, filling anything missing or broken with defaults. */
export function settingsFromStored(raw: unknown): Settings {
  const r = mergeSettings(DEFAULT_SETTINGS, raw ?? {});
  if (r.ok) return r.value;
  // A hand-edited file with one bad value: keep the defaults rather than refuse to boot.
  return structuredClone(DEFAULT_SETTINGS);
}

export type SlidePatch = Partial<Pick<Slide, "title" | "hidden" | "durationSec" | "schedule" | "transition">>;

/** Validates an admin's edit to one slide. */
export function normalizeSlidePatch(patch: unknown): Result<SlidePatch> {
  if (!patch || typeof patch !== "object") return { ok: false, error: "Nothing to save." };
  const p = patch as Record<string, unknown>;
  const out: SlidePatch = {};
  if ("title" in p) {
    if (typeof p.title !== "string") return { ok: false, error: "Title must be text." };
    out.title = p.title.trim().slice(0, LIMITS.titleLength);
  }
  if ("hidden" in p) {
    if (typeof p.hidden !== "boolean") return { ok: false, error: "Hidden must be true or false." };
    out.hidden = p.hidden;
  }
  if ("durationSec" in p) {
    if (p.durationSec === null) out.durationSec = null;
    else {
      const v = intIn(p.durationSec, LIMITS.durationSec);
      if (v === null) return { ok: false, error: `Slide time must be ${LIMITS.durationSec[0]}–${LIMITS.durationSec[1]} seconds.` };
      out.durationSec = v;
    }
  }
  if ("transition" in p) {
    if (p.transition !== null && !isTransition(p.transition)) return { ok: false, error: "Unknown transition." };
    out.transition = p.transition;
  }
  if ("schedule" in p) {
    const r = normalizeSchedule(p.schedule);
    if (!r.ok) return r;
    out.schedule = r.value;
  }
  return { ok: true, value: out };
}
