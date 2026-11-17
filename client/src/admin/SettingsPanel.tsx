// Settings: slide time, transition, time zone, name (standalone), and the weather.

import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { CORNERS, LIMITS, TRANSITIONS, type AdminState, type Location, type Settings } from "@menu/shared";
import { api } from "../api";

type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

const fmtLoc = (l: Location) => l.label || `${l.latitude}, ${l.longitude}`;

/** A number box's text as an integer: digits only ("" → 0, which the server rejects with a message). */
const digits = (v: string): number => Number(v.replace(/\D/g, "").slice(0, 4)) || 0;

function LocationField({ value, onChange, venueLocation, onBox, onTimezone }: { value: Location | null; onChange: (l: Location | null) => void; venueLocation: Location | null; onBox: boolean; onTimezone: (tz: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ label: string; latitude: number; longitude: number; timezone: string | null }[] | null>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const [lat, setLat] = useState(value ? String(value.latitude) : "");
  const [lon, setLon] = useState(value ? String(value.longitude) : "");
  const [label, setLabel] = useState(value?.label ?? "");
  const applyManual = () => {
    if (lat && lon) onChange({ latitude: Number(lat), longitude: Number(lon), ...(label.trim() ? { label: label.trim() } : {}) });
  };
  const onManualKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    applyManual();
  };

  const search = async () => {
    setError("");
    setResults(null);
    try {
      const r = await api.geocode(q);
      setResults(r.results);
      if (!r.results.length) setError("No places found. Try the town and state, or enter coordinates.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    }
  };

  return (
    <div className="ad-loc">
      <p className="ad-loc-current">
        {value ? (
          <>
            <strong>{fmtLoc(value)}</strong>{" "}
            <button type="button" className="link" onClick={() => onChange(null)}>
              {onBox ? "use the venue's location" : "clear"}
            </button>
          </>
        ) : onBox && venueLocation ? (
          <>
            The venue's location: <strong>{fmtLoc(venueLocation)}</strong>
          </>
        ) : (
          <span className="error">No location set: the weather can't show until you pick one.</span>
        )}
      </p>
      <div className="ad-row">
        <input
          type="search"
          placeholder="Search for a town or city"
          maxLength={80}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (q.trim().length >= 2) void search();
            }
          }}
        />
        <button type="button" disabled={q.trim().length < 2} onClick={() => void search()}>
          Search
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      {results && results.length > 0 && (
        <ul className="ad-results">
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  onChange({ latitude: r.latitude, longitude: r.longitude, label: r.label });
                  if (r.timezone) onTimezone(r.timezone);
                  setResults(null);
                  setQ("");
                }}
              >
                {r.label}
              </button>{" "}
              <span className="muted small">
                {r.latitude}, {r.longitude}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="link small" onClick={() => setManual((v) => !v)}>
        {manual ? "Hide coordinates" : "Enter coordinates instead"}
      </button>
      {manual && (
        <div className="ad-row ad-manual">
          {/* Inside the settings form (forms can't nest): Enter here uses these coordinates
              instead of saving the settings, on a real keyboard and the kit's alike. Plain text,
              not inputMode="decimal": decimal pads (iPhone's, the kit's) have no minus sign, and
              every longitude in the Americas is negative. */}
          <input placeholder="Latitude" maxLength={12} autoCapitalize="none" value={lat} onChange={(e) => setLat(e.target.value)} onKeyDown={onManualKey} aria-label="Latitude" />
          <input placeholder="Longitude" maxLength={12} autoCapitalize="none" value={lon} onChange={(e) => setLon(e.target.value)} onKeyDown={onManualKey} aria-label="Longitude" />
          <input placeholder="Label (e.g. Asheville, NC)" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={onManualKey} aria-label="Label" />
          <button type="button" disabled={!lat || !lon} onClick={applyManual}>
            Use
          </button>
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({ state, act }: { state: AdminState; act: Act }) {
  const [draft, setDraft] = useState<Settings>(state.settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(state.settings), [state.settings]);
  const zones = useMemo(timeZones, []);
  const onBox = state.venue !== null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.settings);
  const w = draft.weather;
  const setW = (patch: Partial<Settings["weather"]>) => setDraft((d) => ({ ...d, weather: { ...d.weather, ...patch } }));
  const ov = draft.overlay;
  const setO = (patch: Partial<Settings["overlay"]>) => setDraft((d) => ({ ...d, overlay: { ...d.overlay, ...patch } }));
  const hasLocation = !!(w.location ?? state.venue?.location);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await act(() => api.saveSettings(draft), "Settings saved.");
    setSaving(false);
  };

  const venueUnits = state.venue?.units;
  const tzSource = draft.timezone ? "" : onBox && state.venue?.timezone ? " (the venue's)" : " (from the weather location, or the server's)";

  return (
    <form className="card ad-settings" onSubmit={save}>
      <h2>Settings</h2>

      {!onBox && (
        <label>
          Name on the phone menu
          <input value={draft.name} maxLength={LIMITS.nameLength} placeholder="Menu" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
      )}

      <div className="ad-row">
        <label>
          Seconds per slide
          <input
            type="text"
            inputMode="numeric"
            maxLength={3}
            className="ad-num"
            value={draft.defaultDurationSec || ""}
            onChange={(e) => setDraft({ ...draft, defaultDurationSec: digits(e.target.value) })}
          />
        </label>
        <label>
          Transition
          <select value={draft.transition} onChange={(e) => setDraft({ ...draft, transition: e.target.value as Settings["transition"] })}>
            {TRANSITIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Time zone (for schedules and weather times)
        <input list="menu-zones" maxLength={64} spellCheck={false} value={draft.timezone} placeholder={state.effective.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value.trim() })} />
        <datalist id="menu-zones">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <span className="muted small">
          {draft.timezone ? "Set here." : `Now using ${state.effective.timezone}${tzSource}. Leave empty for that.`}
        </span>
      </label>

      <h3>Clock on the TVs</h3>
      <p className="muted small">A small readout in a corner of the TV, over the slides.</p>
      <div className="ad-row ad-checks">
        <label className="ad-inline">
          <input type="checkbox" checked={ov.time} onChange={(e) => setO({ time: e.target.checked })} /> Time
        </label>
        <label className="ad-inline">
          <input type="checkbox" checked={ov.date} onChange={(e) => setO({ date: e.target.checked })} /> Date
        </label>
        <label className="ad-inline">
          <input type="checkbox" checked={ov.weather} onChange={(e) => setO({ weather: e.target.checked })} /> Current weather
        </label>
      </div>
      {(ov.time || ov.date || ov.weather) && (
        <div className="ad-row">
          <label>
            Corner
            <select value={ov.position} onChange={(e) => setO({ position: e.target.value as Settings["overlay"]["position"] })}>
              {CORNERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {ov.time && (
            <label>
              Clock
              <select value={ov.hour24 ? "24" : "12"} onChange={(e) => setO({ hour24: e.target.value === "24" })}>
                <option value="12">12-hour (4:30 PM)</option>
                <option value="24">24-hour (16:30)</option>
              </select>
            </label>
          )}
        </div>
      )}
      {ov.weather && !hasLocation && <p className="error small">The current weather needs a location: set one under Weather below.</p>}

      <h3>Weather</h3>
      <label className="ad-inline">
        <input type="checkbox" checked={w.enabled} onChange={(e) => setW({ enabled: e.target.checked })} /> Show a weather slide
      </label>
      {(w.enabled || ov.weather) && (
        <>
          <div className="ad-field">
            <span>Location</span>
            <LocationField
              value={w.location}
              onChange={(location) => setW({ location })}
              venueLocation={state.venue?.location ?? null}
              onBox={onBox}
              onTimezone={(tz) => setDraft((d) => (d.timezone || (onBox && state.venue?.timezone) ? d : { ...d, timezone: tz }))}
            />
          </div>
          <div className="ad-row">
            <label>
              Units
              <select value={w.units} onChange={(e) => setW({ units: e.target.value as Settings["weather"]["units"] })}>
                <option value="auto">{onBox && venueUnits ? `Venue's (${venueUnits === "metric" ? "°C" : "°F"})` : "Default (°F)"}</option>
                <option value="imperial">°F, mph</option>
                <option value="metric">°C, km/h</option>
              </select>
            </label>
          </div>
          <p className={`small ${state.weatherStatus.ok ? "muted" : "error"}`}>
            Weather: {state.weatherStatus.message}
            {state.weatherStatus.fetchedAt && ` (updated ${new Date(state.weatherStatus.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`}
          </p>
        </>
      )}
      {w.enabled && (
        <>
          <div className="ad-row">
            <label>
              Every
              <input
                type="text"
                inputMode="numeric"
                maxLength={3}
                className="ad-num"
                value={w.every || ""}
                onChange={(e) => setW({ every: digits(e.target.value) })}
              />
            </label>
            <label>
              &nbsp;
              <select value={w.mode} onChange={(e) => setW({ mode: e.target.value as "minutes" | "slides" })}>
                <option value="minutes">minutes</option>
                <option value="slides">slides</option>
              </select>
            </label>
            <label>
              for (seconds)
              <input
                type="text"
                inputMode="numeric"
                maxLength={3}
                className="ad-num"
                value={w.durationSec || ""}
                onChange={(e) => setW({ durationSec: digits(e.target.value) })}
              />
            </label>
          </div>
          <div className="ad-row">
            <label>
              Forecast
              <select value={w.forecast} onChange={(e) => setW({ forecast: e.target.value as "hours" | "days" })}>
                <option value="hours">Now + next hours</option>
                <option value="days">Now + next 3 days</option>
              </select>
            </label>
          </div>
        </>
      )}

      <div className="ad-row ad-save">
        <button className="primary" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {dirty && (
          <button type="button" className="link" onClick={() => setDraft(state.settings)}>
            Undo changes
          </button>
        )}
      </div>
    </form>
  );
}
