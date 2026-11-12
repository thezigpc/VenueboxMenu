// /tv: the full-screen slideshow cast to the bar's TVs. Nobody can touch it, it runs for
// days, and it must never show an error: it keeps the last good playlist through network
// blips, skips images that won't load, and reloads itself when the server is updated.

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { activeAnnouncement, getVenue, isOnBox, tableMode, type VenueContext } from "@bargames/sdk/client";
import { activeSlides, initialRotation, nextItem, type Playlist, type RotationState, type ShowItem, type Transition } from "@menu/shared";
import { useNow, usePlaylist } from "../usePlaylist";
import { useVenue } from "../useVenue";
import { WeatherSlide } from "../Weather";

interface Layer {
  key: number;
  item: ShowItem;
  /** The weather as it was when this layer went up (it may vanish from the playlist later). */
  weather: Playlist["weather"];
  /** How it comes in (null: no animation, e.g. the very first item). */
  transition: Transition | null;
}

/** Longest transition (fade through black), plus a margin, before the old layer goes. */
const FADE_MS = 1400;
const IMAGE_RETRY_MS = 60_000;

function preload(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(false), 15_000);
    img.onload = () => {
      clearTimeout(t);
      // decode() so the crossfade doesn't stutter on a big image.
      (img.decode ? img.decode().catch(() => undefined) : Promise.resolve()).then(() => resolve(true));
    };
    img.onerror = () => {
      clearTimeout(t);
      resolve(false);
    };
    img.src = url;
  });
}

const sameItem = (a: ShowItem | null, b: ShowItem) =>
  !!a && a.kind === b.kind && (b.kind !== "slide" || (a.kind === "slide" && a.slide.id === b.slide.id));

function useSlideshow(playlist: Playlist | null, clockOffset: number): Layer[] {
  const [layers, setLayers] = useState<Layer[]>([]);
  const pl = useRef(playlist);
  pl.current = playlist;
  const offset = useRef(clockOffset);
  offset.current = clockOffset;
  const rotation = useRef<RotationState | null>(null);
  const current = useRef<ShowItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cleanup = useRef<ReturnType<typeof setTimeout>>();
  const failed = useRef(new Map<string, number>());
  const keySeq = useRef(0);
  const busy = useRef(false);
  const alive = useRef(true);

  const advance = useCallback(async () => {
    if (busy.current || !alive.current) return;
    const p = pl.current;
    if (!p) return;
    busy.current = true;
    clearTimeout(timer.current);
    try {
      const now = Date.now() + offset.current;
      rotation.current ??= initialRotation(now);
      for (const [id, at] of failed.current) if (Date.now() - at > IMAGE_RETRY_MS) failed.current.delete(id);
      const usable = { ...p, slides: p.slides.filter((s) => !failed.current.has(s.id)) };

      // Try slides until one loads (each failure is skipped for a minute).
      let picked: ShowItem | null = null;
      for (let tries = 0; tries <= usable.slides.length; tries++) {
        const r = nextItem(rotation.current, usable, now);
        rotation.current = r.state;
        if (r.item.kind !== "slide") {
          picked = r.item;
          break;
        }
        if (await preload(r.item.slide.url)) {
          picked = r.item;
          break;
        }
        failed.current.set(r.item.slide.id, Date.now());
        usable.slides = usable.slides.filter((s) => s.id !== (r.item as { slide: { id: string } }).slide.id);
      }
      if (!alive.current) return;

      // Images didn't load (the network is down and they aren't cached): rather than
      // "coming soon", keep what's on screen and try again shortly.
      const wantedSlides = activeSlides(p, now).length > 0;
      if (picked?.kind === "empty" && wantedSlides && current.current) {
        timer.current = setTimeout(() => void advance(), 10_000);
        return;
      }
      if (!picked) picked = { kind: "empty", durationMs: p.defaultDurationSec * 1000 };

      if (!sameItem(current.current, picked)) {
        const t = picked.kind === "slide" ? picked.slide.transition : p.transition;
        const layer: Layer = { key: ++keySeq.current, item: picked, weather: p.weather, transition: current.current && t !== "none" ? t : null };
        setLayers((prev) => [...prev.slice(-1), layer]);
        clearTimeout(cleanup.current);
        cleanup.current = setTimeout(() => setLayers((prev) => prev.slice(-1)), FADE_MS + 200);
      }
      current.current = picked;
      timer.current = setTimeout(() => void advance(), picked.durationMs);
    } finally {
      busy.current = false;
    }
  }, []);

  // Declared first so StrictMode's remount marks it alive before the playlist effect runs.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      clearTimeout(cleanup.current);
    };
  }, []);

  // Start once there's a playlist; react to changes that make the current item wrong.
  useEffect(() => {
    if (!playlist) return;
    failed.current.clear();
    const cur = current.current;
    const now = Date.now() + offset.current;
    const stale =
      !cur ||
      (cur.kind === "slide" && !playlist.slides.some((s) => s.id === cur.slide.id)) ||
      (cur.kind === "weather" && !playlist.weather) ||
      (cur.kind === "empty" && activeSlides(playlist, now).length > 0);
    if (stale) void advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist?.version]);

  return layers;
}

/** Box: the SDK's table mode (pointer, wake lock, shared-screen marker). Standalone: our own wake lock. */
function useTvChrome(preview: boolean) {
  useEffect(() => {
    if (preview) return;
    let stopped = false;
    let undo: (() => void) | undefined;
    void getVenue().then((ctx) => {
      if (stopped) return;
      if (isOnBox(ctx)) {
        const tm = tableMode(ctx);
        undo = () => tm.stop();
        return;
      }
      // Standalone: keep the screen awake where the browser allows it.
      type Sentinel = { release(): Promise<void> };
      const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<Sentinel> } };
      if (!nav.wakeLock) return;
      let lock: Sentinel | undefined;
      const take = () => {
        if (document.visibilityState === "visible") nav.wakeLock!.request("screen").then((l) => (lock = l), () => undefined);
      };
      take();
      document.addEventListener("visibilitychange", take);
      undo = () => {
        document.removeEventListener("visibilitychange", take);
        void lock?.release().catch(() => undefined);
      };
    });
    return () => {
      stopped = true;
      undo?.();
    };
  }, [preview]);
}

function PlayQr({ url }: { url: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((s) => live && setSvg(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [url]);
  if (!svg) return null;
  return (
    <div className="tv-qr">
      {/* The SVG is generated locally by the qrcode library from the venue's URL. */}
      <div className="tv-qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="tv-qr-text">Games &amp; menu on your phone</div>
    </div>
  );
}

function ComingSoon({ name, venue }: { name: string; venue: VenueContext | null }) {
  const logo = isOnBox(venue) ? venue.game.theme.logoDarkUrl || venue.game.theme.logoUrl : undefined;
  return (
    <div className="tv-empty">
      {logo ? <img className="tv-empty-logo" src={logo} alt="" /> : <div className="tv-empty-name">{name}</div>}
      <div className="tv-empty-rule" />
      <div className="tv-empty-text">Menu coming soon</div>
    </div>
  );
}

function LayerView({ layer, name, venue }: { layer: Layer; name: string; venue: VenueContext | null }) {
  const it = layer.item;
  return (
    <div className={`tv-layer${layer.transition ? ` tv-in-${layer.transition}` : ""}`}>
      {it.kind === "slide" && <img className="tv-img" src={it.slide.url} alt={it.slide.title} />}
      {it.kind === "weather" && layer.weather && <WeatherSlide weather={layer.weather.data} forecast={layer.weather.forecast} />}
      {it.kind === "empty" && <ComingSoon name={name} venue={venue} />}
    </div>
  );
}

export function TvPage() {
  const preview = new URLSearchParams(location.search).has("preview");
  const { playlist, clockOffset } = usePlaylist({ intervalMs: preview ? 3000 : 5000, reloadOnNewBuild: !preview });
  const venue = useVenue();
  useTvChrome(preview);
  const layers = useSlideshow(playlist, clockOffset);
  const now = useNow(5000);
  const onBox = isOnBox(venue);
  const announcement = onBox ? activeAnnouncement(venue, now) : undefined;
  const playUrl = onBox ? venue.venue.playUrl : undefined;
  const name = playlist?.name ?? (onBox ? venue.game.displayName : "Menu");

  useEffect(() => {
    document.documentElement.classList.add("tv-root");
    return () => document.documentElement.classList.remove("tv-root");
  }, []);

  return (
    <div className="tv-page">
      {layers.map((l) => (
        <LayerView key={l.key} layer={l} name={name} venue={venue} />
      ))}
      {!playlist && <div className="tv-layer tv-blank" />}
      {announcement && (
        <div className="tv-announce" role="status">
          {announcement.text}
        </div>
      )}
      {playUrl && <PlayQr url={playUrl} />}
    </div>
  );
}
