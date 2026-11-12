// Data shapes shared by the server, the TV view, the phone view and the admin page.

/** 0 = Sunday … 6 = Saturday (Date#getDay order). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * When a slide is on. `days` are the days the window *starts* on. With no times it's on
 * all day on those days. `end` before `start` is an overnight window (10 PM - 2 AM).
 */
export interface Schedule {
  days: Weekday[];
  /** "HH:MM", 24-hour, or null for all day. */
  start: string | null;
  end: string | null;
}

/** How a slide comes on screen. "fade" goes through black; "slide" pushes in from the right. */
export type Transition = "crossfade" | "fade" | "slide" | "zoom" | "none";

export interface Slide {
  id: string;
  /** File name in DATA_DIR/slides, served at /slides/<file>. */
  file: string;
  width: number;
  height: number;
  /** A label for staff (defaults to the uploaded file name). Also the image's alt text. */
  title: string;
  hidden: boolean;
  /** Seconds on screen; null = the default from settings. */
  durationSec: number | null;
  /** null = always on. */
  schedule: Schedule | null;
  /** null = the default transition from settings. */
  transition: Transition | null;
  createdAt: string;
}

export type Units = "imperial" | "metric";

export interface Location {
  latitude: number;
  longitude: number;
  label?: string;
}

export interface WeatherSettings {
  enabled: boolean;
  /** Show the weather every N minutes, or after every N slides. */
  mode: "minutes" | "slides";
  every: number;
  durationSec: number;
  /** "hours": now + the next few hours. "days": now + the next 3 days. */
  forecast: "hours" | "days";
  /** null: the venue's location on a box (none standalone: weather stays off). */
  location: Location | null;
  /** "auto": the venue's units on a box, °F standalone. */
  units: Units | "auto";
}

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** A small clock / weather readout in a corner of the TV, over the slides. */
export interface OverlaySettings {
  time: boolean;
  date: boolean;
  /** Current temperature and conditions (needs a weather location). */
  weather: boolean;
  position: Corner;
  /** 24-hour clock ("16:30") instead of "4:30 PM". */
  hour24: boolean;
}

export interface Settings {
  /** Standalone only: the name on the phone page (on a box the venue's name wins). "" = default. */
  name: string;
  defaultDurationSec: number;
  transition: Transition;
  /** IANA zone for schedules and weather times. "" = the venue's on a box, else the server's. */
  timezone: string;
  weather: WeatherSettings;
  overlay: OverlaySettings;
}

export interface WeatherNow {
  temp: number;
  feelsLike: number;
  code: number;
  isDay: boolean;
  wind: number;
  humidity: number;
}

export interface WeatherHour {
  /** Local time "YYYY-MM-DDTHH:MM" in the venue's zone. */
  time: string;
  temp: number;
  code: number;
  isDay: boolean;
  precipChance: number | null;
}

export interface WeatherDay {
  /** "YYYY-MM-DD" in the venue's zone. */
  date: string;
  high: number;
  low: number;
  code: number;
  precipChance: number | null;
}

export interface Weather {
  label: string;
  units: Units;
  timezone: string;
  now: WeatherNow;
  hours: WeatherHour[];
  days: WeatherDay[];
  fetchedAt: string;
}

/** GET /api/playlist: everything the TV and phone views need. */
export interface Playlist {
  /** Changes whenever anything in the response would. */
  version: string;
  /** The client build the server is serving; a long-running TV reloads when it changes. */
  build: string;
  name: string;
  slides: PublicSlide[];
  defaultDurationSec: number;
  transition: Settings["transition"];
  timezone: string;
  weather: {
    mode: WeatherSettings["mode"];
    every: number;
    durationSec: number;
    forecast: WeatherSettings["forecast"];
    data: Weather;
  } | null;
  /** The TV's corner readout; null when it's off. */
  overlay: (Omit<OverlaySettings, "weather"> & { weather: { now: WeatherNow; units: Units } | null }) | null;
  serverTime: number;
}

/** A visible slide as the public sees it (hidden slides are never sent). */
export interface PublicSlide {
  id: string;
  url: string;
  width: number;
  height: number;
  title: string;
  durationSec: number;
  schedule: Schedule | null;
  /** Resolved: the slide's own, or the default. */
  transition: Transition;
}

/** GET /api/admin/state */
export interface AdminState {
  slides: Slide[];
  settings: Settings;
  /** What the box provides (null standalone), so the admin can show "venue default". */
  venue: { location: Location | null; timezone: string | null; units: Units | null } | null;
  effective: { timezone: string; units: Units; location: Location | null };
  weatherStatus: { ok: boolean; message: string; fetchedAt: string | null };
  limits: { maxUploadMb: number; maxSlides: number; maxWidth: number; maxHeight: number };
}
