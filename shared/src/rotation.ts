// What the TV shows next: the slides that are on right now, in order, with the weather
// slipped in every N minutes or every N slides. Pure, so it's tested without a browser.

import { isScheduledNow } from "./schedule.js";
import type { Playlist, PublicSlide } from "./types.js";

export type ShowItem =
  | { kind: "slide"; slide: PublicSlide; durationMs: number }
  | { kind: "weather"; durationMs: number }
  /** Nothing to show: "Menu coming soon". */
  | { kind: "empty"; durationMs: number };

export interface RotationState {
  lastSlideId: string | null;
  /** Position of the last slide in the playlist, for when that slide has since been deleted. */
  lastIndex: number;
  /** Slides (or "coming soon" screens) shown since the weather last was. */
  sinceWeather: number;
  lastWeatherAt: number;
  lastKind: ShowItem["kind"] | null;
}

export function initialRotation(now: number): RotationState {
  // The weather waits one interval before its first showing: the menu comes first.
  return { lastSlideId: null, lastIndex: -1, sinceWeather: 0, lastWeatherAt: now, lastKind: null };
}

/** The slides that are on at `now` (schedules in the playlist's time zone). */
export function activeSlides(playlist: Pick<Playlist, "slides" | "timezone">, now: number): PublicSlide[] {
  return playlist.slides.filter((s) => isScheduledNow(s.schedule, now, playlist.timezone));
}

const MIN_MS = 2_000;

export function nextItem(
  state: RotationState,
  playlist: Pick<Playlist, "slides" | "timezone" | "weather" | "defaultDurationSec">,
  now: number,
): { item: ShowItem; state: RotationState } {
  const w = playlist.weather;
  const weatherDue =
    !!w &&
    state.lastKind !== "weather" &&
    (w.mode === "minutes" ? now - state.lastWeatherAt >= w.every * 60_000 : state.sinceWeather >= w.every);
  if (w && weatherDue) {
    return {
      item: { kind: "weather", durationMs: Math.max(MIN_MS, w.durationSec * 1000) },
      state: { ...state, sinceWeather: 0, lastWeatherAt: now, lastKind: "weather" },
    };
  }

  const slides = playlist.slides;
  const on = new Set(activeSlides(playlist, now).map((s) => s.id));
  if (on.size === 0) {
    return {
      item: { kind: "empty", durationMs: Math.max(MIN_MS, playlist.defaultDurationSec * 1000) },
      state: { ...state, sinceWeather: state.sinceWeather + 1, lastKind: "empty" },
    };
  }
  let from = state.lastSlideId ? slides.findIndex((s) => s.id === state.lastSlideId) : -1;
  if (from < 0) from = Math.min(state.lastIndex, slides.length) - (state.lastSlideId ? 1 : 0);
  for (let step = 1; step <= slides.length; step++) {
    const i = (((from + step) % slides.length) + slides.length) % slides.length;
    const slide = slides[i];
    if (!on.has(slide.id)) continue;
    return {
      item: { kind: "slide", slide, durationMs: Math.max(MIN_MS, slide.durationSec * 1000) },
      state: { ...state, lastSlideId: slide.id, lastIndex: i, sinceWeather: state.sinceWeather + 1, lastKind: "slide" },
    };
  }
  // Unreachable (on.size > 0), but keep the TV going regardless.
  return { item: { kind: "empty", durationMs: playlist.defaultDurationSec * 1000 }, state: { ...state, lastKind: "empty" } };
}
