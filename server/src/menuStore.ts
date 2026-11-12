// The slides and settings, kept in memory and saved to DATA_DIR as JSON (the kit's atomic
// store). Images live in DATA_DIR/slides/, named by slide id.

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createJsonStore, log, type JsonStore } from "@bargames/gamekit/server";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeSlidePatch,
  settingsFromStored,
  type Settings,
  type Slide,
} from "@menu/shared";
import { processImage, UploadError } from "./images.js";

export const MAX_SLIDES = 200;
const SLIDES_FILE = "slides.json";
const SETTINGS_FILE = "settings.json";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

function isSlide(v: unknown): v is Slide {
  const s = v as Slide;
  return !!s && typeof s.id === "string" && typeof s.file === "string" && /^[\w-]+\.(jpg|png|webp)$/.test(s.file);
}

function slidesFromStored(raw: unknown): Slide[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { slides?: unknown }).slides)) return [];
  const out: Slide[] = [];
  for (const s of (raw as { slides: unknown[] }).slides) {
    if (!isSlide(s)) continue;
    const patch = normalizeSlidePatch({ title: s.title ?? "", hidden: !!s.hidden, durationSec: s.durationSec ?? null, schedule: s.schedule ?? null, transition: s.transition ?? null });
    if (!patch.ok) continue;
    out.push({
      id: s.id,
      file: s.file,
      width: Number(s.width) || 0,
      height: Number(s.height) || 0,
      title: patch.value.title ?? "",
      hidden: patch.value.hidden ?? false,
      durationSec: patch.value.durationSec ?? null,
      schedule: patch.value.schedule ?? null,
      transition: patch.value.transition ?? null,
      createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date(0).toISOString(),
    });
  }
  return out;
}

export class MenuStore {
  readonly slidesDir: string;
  private readonly json: JsonStore;
  private slides: Slide[] = [];
  private settings: Settings = structuredClone(DEFAULT_SETTINGS);
  /** Bumped on every change; part of the playlist's version. */
  revision = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dataDir: string) {
    this.json = createJsonStore(dataDir);
    this.slidesDir = path.join(dataDir, "slides");
  }

  async init(): Promise<void> {
    await mkdir(this.slidesDir, { recursive: true });
    this.slides = slidesFromStored(await this.json.read(SLIDES_FILE));
    this.settings = settingsFromStored(await this.json.read(SETTINGS_FILE));
  }

  /** Runs changes one at a time, so two admins saving at once never lose an edit. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async saveSlides(): Promise<void> {
    this.revision++;
    await this.json.write(SLIDES_FILE, { slides: this.slides });
  }

  getSlides(): Slide[] {
    return this.slides;
  }

  getSettings(): Settings {
    return this.settings;
  }

  updateSettings(patch: unknown): Promise<Result<Settings>> {
    return this.serial(async () => {
      const r = mergeSettings(this.settings, patch);
      if (!r.ok) return r;
      this.settings = r.value;
      this.revision++;
      await this.json.write(SETTINGS_FILE, this.settings);
      return r;
    });
  }

  addSlide(data: Buffer, title: string): Promise<Result<Slide>> {
    return this.serial(async () => {
      if (this.slides.length >= MAX_SLIDES) return { ok: false, error: `There's a limit of ${MAX_SLIDES} slides. Delete some first.`, status: 409 };
      let img;
      try {
        img = await processImage(data);
      } catch (err) {
        if (err instanceof UploadError) return { ok: false, error: err.message, status: 415 };
        throw err;
      }
      const id = randomBytes(9).toString("base64url");
      const file = `${id}.${img.ext}`;
      const tmp = path.join(this.slidesDir, `.${file}.${process.pid}.tmp`);
      await writeFile(tmp, img.data);
      await rename(tmp, path.join(this.slidesDir, file));
      const slide: Slide = {
        id,
        file,
        width: img.width,
        height: img.height,
        title: title.trim().slice(0, 80) || "Slide",
        hidden: false,
        durationSec: null,
        schedule: null,
        transition: null,
        createdAt: new Date().toISOString(),
      };
      this.slides = [...this.slides, slide];
      await this.saveSlides();
      log.info("slides", "added", { id, w: img.width, h: img.height, bytes: img.data.length, changed: img.changed });
      return { ok: true, value: slide };
    });
  }

  updateSlide(id: string, patch: unknown): Promise<Result<Slide>> {
    return this.serial(async () => {
      const i = this.slides.findIndex((s) => s.id === id);
      if (i < 0) return { ok: false, error: "That slide is gone.", status: 404 };
      const r = normalizeSlidePatch(patch);
      if (!r.ok) return r;
      const slide = { ...this.slides[i], ...r.value };
      this.slides = this.slides.map((s, j) => (j === i ? slide : s));
      await this.saveSlides();
      return { ok: true, value: slide };
    });
  }

  deleteSlide(id: string): Promise<Result<true>> {
    return this.serial(async () => {
      const slide = this.slides.find((s) => s.id === id);
      if (!slide) return { ok: false, error: "That slide is already gone.", status: 404 };
      this.slides = this.slides.filter((s) => s.id !== id);
      await this.saveSlides();
      await unlink(path.join(this.slidesDir, slide.file)).catch((err) => log.warn("slides", "couldn't delete image", { file: slide.file, err: String(err) }));
      log.info("slides", "deleted", { id });
      return { ok: true, value: true };
    });
  }

  /** New order. Must name every slide exactly once (so a stale admin page can't drop one). */
  reorder(ids: unknown): Promise<Result<Slide[]>> {
    return this.serial(async () => {
      if (!Array.isArray(ids) || ids.length !== this.slides.length || new Set(ids).size !== ids.length) {
        return { ok: false, error: "The slide list changed. Reload the page and try again.", status: 409 };
      }
      const byId = new Map(this.slides.map((s) => [s.id, s]));
      const next: Slide[] = [];
      for (const id of ids) {
        const s = byId.get(String(id));
        if (!s) return { ok: false, error: "The slide list changed. Reload the page and try again.", status: 409 };
        next.push(s);
      }
      this.slides = next;
      await this.saveSlides();
      return { ok: true, value: next };
    });
  }
}
