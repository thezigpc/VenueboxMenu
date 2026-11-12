// Slides: upload (drag and drop, several at once), reorder, hide/show, per-slide time and
// schedule, delete.

import { useEffect, useRef, useState, type DragEvent } from "react";
import { bgUrl } from "@bargames/sdk/client";
import { DAY_SHORT, describeSchedule, isScheduledNow, TRANSITIONS, type AdminState, type Schedule, type Slide, type Transition, type Weekday } from "@menu/shared";
import { api } from "../api";

type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
type SetNotice = (n: { text: string; error: boolean } | null) => void;

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

function Uploader({ state, setNotice, reload }: { state: AdminState; setNotice: SetNotice; reload: () => Promise<void> }) {
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const maxBytes = state.limits.maxUploadMb * 1024 * 1024;

  const uploadAll = async (files: File[]) => {
    if (!files.length || progress) return;
    const problems: string[] = [];
    const ok = files.filter((f) => {
      if (f.size > maxBytes) problems.push(`${f.name}: over ${state.limits.maxUploadMb} MB`);
      else if (f.type && !ACCEPT.includes(f.type)) problems.push(`${f.name}: not a JPG, PNG or WebP`);
      else return true;
      return false;
    });
    setProgress({ done: 0, total: ok.length });
    let added = 0;
    for (const f of ok) {
      try {
        await api.upload(f);
        added++;
      } catch (err) {
        problems.push(`${f.name}: ${err instanceof Error ? err.message : "failed"}`);
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setProgress(null);
    await reload();
    if (problems.length) setNotice({ text: `${added} added. Not added: ${problems.join("; ")}`, error: true });
    else setNotice({ text: added === 1 ? "Slide added." : `${added} slides added.`, error: false });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void uploadAll([...e.dataTransfer.files]);
  };

  return (
    <div
      className={`ad-drop${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {progress ? (
        <p>
          Uploading {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </p>
      ) : (
        <>
          <p>
            <strong>Drop slide images here</strong> or{" "}
            <button className="link" onClick={() => input.current?.click()}>
              choose files
            </button>
          </p>
          <p className="muted small">
            JPG, PNG or WebP, up to {state.limits.maxUploadMb} MB each. Design them 16:9 (1920×1080); bigger images are shrunk to fit.
          </p>
        </>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(",")}
        multiple
        hidden
        onChange={(e) => {
          void uploadAll([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

function ScheduleEditor({ initial, onSave, onCancel }: { initial: Schedule | null; onSave: (s: Schedule | null) => void; onCancel: () => void }) {
  const [days, setDays] = useState<Set<Weekday>>(new Set(initial?.days ?? [1, 2, 3, 4, 5]));
  const [allDay, setAllDay] = useState(!initial?.start);
  const [start, setStart] = useState(initial?.start ?? "16:00");
  const [end, setEnd] = useState(initial?.end ?? "18:00");
  const draft: Schedule = { days: [...days].sort(), start: allDay ? null : start, end: allDay ? null : end };
  const valid = days.size > 0 && (allDay || (start && end && start !== end));

  return (
    <div className="ad-sched">
      <div className="ad-days" role="group" aria-label="Days">
        {ALL_DAYS.map((d) => (
          <button
            key={d}
            type="button"
            className={`ad-day${days.has(d) ? " is-on" : ""}`}
            aria-pressed={days.has(d)}
            onClick={() => {
              const next = new Set(days);
              if (next.has(d)) next.delete(d);
              else next.add(d);
              setDays(next);
            }}
          >
            {DAY_SHORT[d]}
          </button>
        ))}
      </div>
      <label className="ad-inline">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
      </label>
      {!allDay && (
        <div className="ad-times">
          <label>
            From <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            to <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
      )}
      <p className="muted small">{valid ? `Shows ${describeSchedule(draft)}${!allDay && end < start ? " (into the next morning)" : ""}.` : "Pick at least one day and two different times."}</p>
      <div className="ad-row">
        <button className="primary" disabled={!valid} onClick={() => onSave(draft)}>
          Save schedule
        </button>
        {initial && <button onClick={() => onSave(null)}>Always show</button>}
        <button className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SlideRow({
  slide,
  index,
  count,
  defaultDuration,
  defaultTransition,
  timezone,
  act,
  move,
  drag,
}: {
  slide: Slide;
  index: number;
  count: number;
  defaultDuration: number;
  defaultTransition: Transition;
  timezone: string;
  act: Act;
  move: (from: number, to: number) => void;
  drag: { onStart: () => void; onOver: () => void; onEnd: () => void; over: boolean };
}) {
  const [title, setTitle] = useState(slide.title);
  const [duration, setDuration] = useState(slide.durationSec ? String(slide.durationSec) : "");
  const [editing, setEditing] = useState(false);
  useEffect(() => setTitle(slide.title), [slide.title]);
  useEffect(() => setDuration(slide.durationSec ? String(slide.durationSec) : ""), [slide.durationSec]);

  const update = (patch: Partial<Slide>, ok?: string) => act(() => api.updateSlide(slide.id, patch), ok);
  const onNow = !slide.hidden && isScheduledNow(slide.schedule, Date.now(), timezone);

  const saveDuration = () => {
    const v = duration.trim() === "" ? null : Number(duration);
    if (v === slide.durationSec) return;
    void update({ durationSec: v });
  };

  return (
    <li
      className={`ad-slide${slide.hidden ? " is-hidden" : ""}${drag.over ? " is-drop" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        drag.onOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        drag.onEnd();
      }}
    >
      <div
        className="ad-handle"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", slide.id);
          drag.onStart();
        }}
        onDragEnd={drag.onEnd}
        title="Drag to reorder"
        aria-hidden="true"
      >
        ⋮⋮
      </div>
      <a className="ad-thumb" href={bgUrl(`/slides/${slide.file}`)} target="_blank" rel="noreferrer">
        <img src={bgUrl(`/slides/${slide.file}`)} alt="" loading="lazy" />
      </a>
      <div className="ad-slide-body">
        <input className="ad-title" value={title} aria-label="Slide name" onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== slide.title && void update({ title })} />
        <div className="ad-chips">
          {slide.hidden ? <span className="chip">Hidden</span> : onNow ? <span className="chip is-on">On now</span> : <span className="chip">Not on now</span>}
          <span className="chip">{describeSchedule(slide.schedule)}</span>
          <span className="chip muted">
            {slide.width}×{slide.height}
          </span>
        </div>
        <div className="ad-row ad-controls">
          <label className="ad-inline">
            <input
              type="number"
              min={3}
              max={600}
              inputMode="numeric"
              placeholder={String(defaultDuration)}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              onBlur={saveDuration}
              onKeyDown={(e) => e.key === "Enter" && saveDuration()}
              className="ad-num"
              aria-label="Seconds on screen"
            />{" "}
            sec
          </label>
          <select
            aria-label="Transition"
            value={slide.transition ?? ""}
            onChange={(e) => void update({ transition: (e.target.value || null) as Transition | null })}
          >
            <option value="">Default ({TRANSITIONS.find((t) => t.id === defaultTransition)?.label.toLowerCase()})</option>
            {TRANSITIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button onClick={() => void update({ hidden: !slide.hidden }, slide.hidden ? "Shown." : "Hidden.")}>{slide.hidden ? "Show" : "Hide"}</button>
          <button onClick={() => setEditing((v) => !v)}>Schedule</button>
          <button aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}>
            ↑
          </button>
          <button aria-label="Move down" disabled={index === count - 1} onClick={() => move(index, index + 1)}>
            ↓
          </button>
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Delete "${slide.title}"? This can't be undone.`)) void act(() => api.deleteSlide(slide.id), "Deleted.");
            }}
          >
            Delete
          </button>
        </div>
        {editing && (
          <ScheduleEditor
            initial={slide.schedule}
            onCancel={() => setEditing(false)}
            onSave={(schedule) => {
              setEditing(false);
              void update({ schedule }, "Schedule saved.");
            }}
          />
        )}
      </div>
    </li>
  );
}

export function SlidesPanel({ state, act, setNotice, reload }: { state: AdminState; act: Act; setNotice: SetNotice; reload: () => Promise<void> }) {
  const [order, setOrder] = useState(state.slides);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  useEffect(() => setOrder(state.slides), [state.slides]);

  const commit = (next: Slide[]) => {
    setOrder(next);
    void act(() => api.reorder(next.map((s) => s.id)));
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s);
    commit(next);
  };

  const visible = order.filter((s) => !s.hidden).length;
  return (
    <section className="card">
      <h2>Slides</h2>
      <Uploader state={state} setNotice={setNotice} reload={reload} />
      {order.length === 0 ? (
        <p className="muted">No slides yet. The TVs show “Menu coming soon” until you add one.</p>
      ) : (
        <>
          <p className="muted small">
            {order.length} slide{order.length === 1 ? "" : "s"}, {visible} shown. Drag ⋮⋮ or use the arrows to change the order. Seconds left empty use the default ({state.settings.defaultDurationSec} s).
          </p>
          <ol className="ad-slides">
            {order.map((s, i) => (
              <SlideRow
                key={s.id}
                slide={s}
                index={i}
                count={order.length}
                defaultDuration={state.settings.defaultDurationSec}
                defaultTransition={state.settings.transition}
                timezone={state.effective.timezone}
                act={act}
                move={move}
                drag={{
                  over: dragOver === i && dragFrom !== null && dragFrom !== i,
                  onStart: () => setDragFrom(i),
                  onOver: () => dragFrom !== null && setDragOver(i),
                  onEnd: () => {
                    if (dragFrom !== null && dragOver !== null) move(dragFrom, dragOver);
                    setDragFrom(null);
                    setDragOver(null);
                  },
                }}
              />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
