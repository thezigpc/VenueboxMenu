// Weather from Open-Meteo (free, no API key), fetched by the server and cached, so a bar
// full of TVs and phones makes one request every 15 minutes. A failure never reaches a
// TV: the last good forecast is kept for a while, then the weather slide is just skipped.

import { log } from "@bargames/gamekit/server";
import type { Location, Units, Weather, WeatherDay, WeatherHour } from "@menu/shared";

export const FRESH_MS = 15 * 60_000;
/** After this long without a successful fetch the forecast is too old to show. */
export const STALE_MS = 3 * 60 * 60_000;
const RETRY_MS = 2 * 60_000;
const TIMEOUT_MS = 8_000;
const HOURS = 6;

export interface WeatherQuery {
  location: Location;
  units: Units;
  /** IANA zone, or "" to let Open-Meteo use the location's own zone. */
  timezone: string;
}

interface Entry {
  data: Weather | null;
  fetchedAt: number;
  lastTryAt: number;
  error: string | null;
  inflight: Promise<void> | null;
}

const keyOf = (q: WeatherQuery) => `${q.location.latitude},${q.location.longitude},${q.units},${q.timezone}`;

export function forecastUrl(q: WeatherQuery): string {
  const p = new URLSearchParams({
    latitude: String(q.location.latitude),
    longitude: String(q.location.longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m",
    hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: q.timezone || "auto",
    forecast_days: "4",
    temperature_unit: q.units === "imperial" ? "fahrenheit" : "celsius",
    wind_speed_unit: q.units === "imperial" ? "mph" : "kmh",
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const nOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** Open-Meteo's JSON → what the TV draws. Throws on a response missing the essentials. */
export function normalizeForecast(raw: unknown, q: WeatherQuery, now = Date.now()): Weather {
  const r = raw as Record<string, any>;
  const c = r?.current;
  if (!c || !Number.isFinite(n(c.temperature_2m)) || !Number.isFinite(n(c.weather_code))) throw new Error("forecast has no current conditions");
  const timezone = typeof r.timezone === "string" && r.timezone ? r.timezone : q.timezone || "UTC";

  const hours: WeatherHour[] = [];
  const h = r.hourly ?? {};
  const times: unknown[] = Array.isArray(h.time) ? h.time : [];
  const currentHour = typeof c.time === "string" ? c.time.slice(0, 13) : "";
  for (let i = 0; i < times.length && hours.length < HOURS; i++) {
    const t = times[i];
    if (typeof t !== "string" || t.slice(0, 13) <= currentHour) continue;
    const temp = n(h.temperature_2m?.[i]);
    const code = n(h.weather_code?.[i]);
    if (!Number.isFinite(temp) || !Number.isFinite(code)) continue;
    hours.push({ time: t, temp: Math.round(temp), code, isDay: h.is_day?.[i] === 1, precipChance: nOrNull(h.precipitation_probability?.[i]) });
  }

  const days: WeatherDay[] = [];
  const d = r.daily ?? {};
  const dates: unknown[] = Array.isArray(d.time) ? d.time : [];
  for (let i = 0; i < dates.length; i++) {
    const hi = n(d.temperature_2m_max?.[i]);
    const lo = n(d.temperature_2m_min?.[i]);
    const code = n(d.weather_code?.[i]);
    if (typeof dates[i] !== "string" || !Number.isFinite(hi) || !Number.isFinite(lo) || !Number.isFinite(code)) continue;
    days.push({ date: dates[i] as string, high: Math.round(hi), low: Math.round(lo), code, precipChance: nOrNull(d.precipitation_probability_max?.[i]) });
  }

  return {
    label: q.location.label ?? "",
    units: q.units,
    timezone,
    now: {
      temp: Math.round(n(c.temperature_2m)),
      feelsLike: Math.round(Number.isFinite(n(c.apparent_temperature)) ? n(c.apparent_temperature) : n(c.temperature_2m)),
      code: n(c.weather_code),
      isDay: c.is_day === 1,
      wind: Math.round(Number.isFinite(n(c.wind_speed_10m)) ? n(c.wind_speed_10m) : 0),
      humidity: Math.round(Number.isFinite(n(c.relative_humidity_2m)) ? n(c.relative_humidity_2m) : 0),
    },
    hours,
    days,
    fetchedAt: new Date(now).toISOString(),
  };
}

export class WeatherService {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async refresh(q: WeatherQuery, e: Entry): Promise<void> {
    e.lastTryAt = this.now();
    try {
      const res = await this.fetchFn(forecastUrl(q), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
      e.data = normalizeForecast(await res.json(), q, this.now());
      e.fetchedAt = this.now();
      e.error = null;
    } catch (err) {
      e.error = err instanceof Error ? err.message : String(err);
      log.warn("weather", "fetch failed", { err: e.error });
    }
  }

  /**
   * The forecast for q, or null when there's none recent enough. Returns a cached forecast
   * straight away (refreshing in the background when it's due); waits only on the first fetch.
   */
  async get(q: WeatherQuery): Promise<Weather | null> {
    const key = keyOf(q);
    let e = this.entries.get(key);
    if (!e) {
      // Only the current query matters; drop the rest so a moved location doesn't pile up.
      this.entries.clear();
      e = { data: null, fetchedAt: 0, lastTryAt: 0, error: null, inflight: null };
      this.entries.set(key, e);
    }
    const now = this.now();
    const due = now - e.fetchedAt >= FRESH_MS && now - e.lastTryAt >= (e.error ? RETRY_MS : 0);
    if (due && !e.inflight) {
      const entry = e;
      entry.inflight = this.refresh(q, entry).finally(() => (entry.inflight = null));
    }
    if (!e.data && e.inflight) await e.inflight;
    return e.data && this.now() - e.fetchedAt < STALE_MS ? e.data : null;
  }

  /** For the admin page: did the last fetch work? */
  status(q: WeatherQuery | null): { ok: boolean; message: string; fetchedAt: string | null } {
    if (!q) return { ok: false, message: "No location set.", fetchedAt: null };
    const e = this.entries.get(keyOf(q));
    if (!e || (!e.data && !e.error)) return { ok: false, message: "Not fetched yet.", fetchedAt: null };
    const fetchedAt = e.fetchedAt ? new Date(e.fetchedAt).toISOString() : null;
    if (e.error) return { ok: false, message: `Last update failed: ${e.error}`, fetchedAt };
    return { ok: true, message: "Up to date.", fetchedAt };
  }
}

export interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
  timezone: string | null;
}

/** Place search for the admin's location field (Open-Meteo's geocoder, also keyless). */
export async function geocode(query: string, fetchFn: typeof fetch = fetch): Promise<GeocodeResult[]> {
  const p = new URLSearchParams({ name: query, count: "6", language: "en", format: "json" });
  const res = await fetchFn(`https://geocoding-api.open-meteo.com/v1/search?${p}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
  const body = (await res.json()) as { results?: Record<string, unknown>[] };
  return (body.results ?? [])
    .filter((r) => Number.isFinite(n(r.latitude)) && Number.isFinite(n(r.longitude)) && typeof r.name === "string")
    .map((r) => {
      const region = r.country_code === "US" && typeof r.admin1 === "string" ? r.admin1 : typeof r.country === "string" ? r.country : "";
      return {
        label: [r.name as string, region].filter(Boolean).join(", "),
        latitude: Math.round(n(r.latitude) * 1e4) / 1e4,
        longitude: Math.round(n(r.longitude) * 1e4) / 1e4,
        timezone: typeof r.timezone === "string" ? r.timezone : null,
      };
    });
}
