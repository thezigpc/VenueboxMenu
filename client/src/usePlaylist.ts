// The playlist, polled. A TV runs for days, so this never gives up and never shows an
// error: a failed poll keeps the last good playlist (also kept in localStorage, so a TV
// that reloads during an outage still has its menu).

import { useEffect, useRef, useState } from "react";
import { bgUrl } from "@bargames/sdk/client";
import type { Playlist } from "@menu/shared";

const STORE_KEY = "menu.lastPlaylist";

function loadSaved(): Playlist | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Playlist) : null;
  } catch {
    return null;
  }
}

function save(p: Playlist): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* full or blocked: memory only */
  }
}

export interface PlaylistState {
  playlist: Playlist | null;
  /** False until the first answer from the server (a saved playlist may show meanwhile). */
  loaded: boolean;
  /** Server clock minus this device's clock, for schedules. */
  clockOffset: number;
}

export function usePlaylist(opts: { intervalMs: number; reloadOnNewBuild?: boolean }): PlaylistState {
  const [state, setState] = useState<PlaylistState>(() => ({ playlist: loadSaved(), loaded: false, clockOffset: 0 }));
  const reloadRef = useRef(opts.reloadOnNewBuild);
  reloadRef.current = opts.reloadOnNewBuild;

  useEffect(() => {
    let etag = "";
    let firstBuild = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let failures = 0;

    const tick = async () => {
      try {
        const res = await fetch(bgUrl("/api/playlist"), { cache: "no-store", headers: etag ? { "if-none-match": etag } : {} });
        if (res.status === 200) {
          const p = (await res.json()) as Playlist;
          etag = res.headers.get("etag") ?? "";
          if (!firstBuild) firstBuild = p.build;
          else if (reloadRef.current && p.build !== firstBuild && p.build !== "dev") {
            // The server was updated: load the new client.
            location.reload();
            return;
          }
          save(p);
          if (!stopped) setState({ playlist: p, loaded: true, clockOffset: p.serverTime - Date.now() });
        } else if (res.status === 304) {
          if (!stopped) setState((s) => (s.loaded ? s : { ...s, loaded: true }));
        }
        failures = 0;
      } catch {
        failures++;
      }
      if (stopped) return;
      // Back off a little while the server is unreachable (at most a minute).
      const wait = failures ? Math.min(60_000, opts.intervalMs * 2 ** Math.min(failures, 4)) : opts.intervalMs;
      timer = setTimeout(tick, wait);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [opts.intervalMs]);

  return state;
}

/** Re-renders every `ms` and returns the server-corrected time. */
export function useNow(ms: number, offset = 0): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const t = setInterval(() => setNow(Date.now() + offset), ms);
    return () => clearInterval(t);
  }, [ms, offset]);
  return now;
}
