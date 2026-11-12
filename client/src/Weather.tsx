// The weather: a full TV slide and a phone card. Icons are inline SVG (a cast TV renders
// in a headless browser that may have no emoji font).

import { describeWeather, type Weather, type WeatherIcon } from "@menu/shared";

const SUN = "#f6c344";
const CLOUD = "#d9dee6";
const CLOUD_DARK = "#9aa5b4";
const RAIN = "#5fa8f0";

function Sun({ cx = 32, cy = 32, r = 11 }: { cx?: number; cy?: number; r?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return (
      <line
        key={i}
        x1={cx + Math.cos(a) * (r + 5)}
        y1={cy + Math.sin(a) * (r + 5)}
        x2={cx + Math.cos(a) * (r + 10)}
        y2={cy + Math.sin(a) * (r + 10)}
        stroke={SUN}
        strokeWidth={3.5}
        strokeLinecap="round"
      />
    );
  });
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={SUN} />
      {rays}
    </g>
  );
}

function Moon({ cx = 30, cy = 30 }: { cx?: number; cy?: number }) {
  return <path d={`M${cx + 8} ${cy - 16} A18 18 0 1 0 ${cx + 16} ${cy + 10} A14 14 0 0 1 ${cx + 8} ${cy - 16} Z`} fill="#e8e3c8" />;
}

const cloudPath = "M18 50 h30 a11 11 0 0 0 0 -22 a15 15 0 0 0 -28 -4 a10 10 0 0 0 -2 26 z";

function Cloud({ dark = false, dy = 0 }: { dark?: boolean; dy?: number }) {
  return <path d={cloudPath} transform={`translate(0 ${dy})`} fill={dark ? CLOUD_DARK : CLOUD} />;
}

function Drops({ snow = false, few = false }: { snow?: boolean; few?: boolean }) {
  const xs = few ? [26, 40] : [22, 33, 44];
  return (
    <g>
      {xs.map((x) =>
        snow ? (
          <circle key={x} cx={x} cy={56} r={3} fill="#ffffff" />
        ) : (
          <line key={x} x1={x} y1={52} x2={x - 3} y2={60} stroke={RAIN} strokeWidth={3.5} strokeLinecap="round" />
        ),
      )}
    </g>
  );
}

export function WeatherIconSvg({ icon, isDay = true, size }: { icon: WeatherIcon; isDay?: boolean; size?: string }) {
  let body;
  switch (icon) {
    case "clear":
      body = isDay ? <Sun /> : <Moon />;
      break;
    case "partly":
      body = (
        <>
          {isDay ? <Sun cx={24} cy={22} r={9} /> : <Moon cx={18} cy={16} />}
          <Cloud dy={6} />
        </>
      );
      break;
    case "cloudy":
      body = <Cloud dy={-2} />;
      break;
    case "fog":
      body = (
        <g stroke={CLOUD} strokeWidth={4} strokeLinecap="round">
          <line x1={12} y1={24} x2={52} y2={24} />
          <line x1={8} y1={34} x2={48} y2={34} />
          <line x1={16} y1={44} x2={56} y2={44} />
        </g>
      );
      break;
    case "drizzle":
      body = (
        <>
          <Cloud dy={-6} />
          <Drops few />
        </>
      );
      break;
    case "rain":
      body = (
        <>
          <Cloud dark dy={-6} />
          <Drops />
        </>
      );
      break;
    case "snow":
      body = (
        <>
          <Cloud dy={-6} />
          <Drops snow />
        </>
      );
      break;
    case "storm":
      body = (
        <>
          <Cloud dark dy={-8} />
          <path d="M34 42 l-8 12 h7 l-4 10 l11 -14 h-7 l4 -8 z" fill={SUN} />
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="wx-icon">
      {body}
    </svg>
  );
}

const unit = (w: Weather) => (w.units === "imperial" ? "°F" : "°C");
const windUnit = (w: Weather) => (w.units === "imperial" ? "mph" : "km/h");

/** "5 PM" from "2026-11-11T17:00" (already in the venue's zone). */
export function hourLabel(local: string): string {
  const h = Number(local.slice(11, 13));
  if (!Number.isFinite(h)) return local;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
}

/** "Thu" from "2026-11-12". */
export function dayLabel(date: string, short = true): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (short ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])[day];
}

/** Full-screen TV weather (16:9). */
export function WeatherSlide({ weather: w, forecast }: { weather: Weather; forecast: "hours" | "days" }) {
  const now = describeWeather(w.now.code);
  const today = w.days[0];
  const cols =
    forecast === "hours"
      ? w.hours.map((h) => ({ key: h.time, label: hourLabel(h.time), icon: describeWeather(h.code).icon, isDay: h.isDay, main: `${h.temp}°`, sub: h.precipChance ? `${h.precipChance}%` : "" }))
      : w.days.slice(1, 4).map((d) => ({ key: d.date, label: dayLabel(d.date, false), icon: describeWeather(d.code).icon, isDay: true, main: `${d.high}°`, sub: `${d.low}°` }));
  return (
    <div className="wx-slide">
      <div className="wx-now">
        <div className="wx-place">{w.label || "Weather"}</div>
        <div className="wx-now-main">
          <WeatherIconSvg icon={now.icon} isDay={w.now.isDay} />
          <div className="wx-temp">
            {w.now.temp}
            <span className="wx-unit">{unit(w)}</span>
          </div>
        </div>
        <div className="wx-desc">{now.text}</div>
        <div className="wx-meta">
          {today && (
            <span>
              High {today.high}° · Low {today.low}°
            </span>
          )}
          <span>Feels like {w.now.feelsLike}°</span>
          <span>
            Wind {w.now.wind} {windUnit(w)}
          </span>
        </div>
      </div>
      <div className={`wx-cols wx-cols-${cols.length}`}>
        {cols.map((c) => (
          <div key={c.key} className="wx-col">
            <div className="wx-col-label">{c.label}</div>
            <WeatherIconSvg icon={c.icon} isDay={c.isDay} />
            <div className="wx-col-main">{c.main}</div>
            <div className="wx-col-sub">{forecast === "hours" ? (c.sub ? `${c.sub} rain` : " ") : c.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The phone's weather card. */
export function WeatherCard({ weather: w }: { weather: Weather }) {
  const now = describeWeather(w.now.code);
  const today = w.days[0];
  return (
    <section className="wx-card" aria-label="Weather">
      <div className="wx-card-now">
        <WeatherIconSvg icon={now.icon} isDay={w.now.isDay} size="56" />
        <div>
          <div className="wx-card-temp">
            {w.now.temp}
            {unit(w)} <span className="wx-card-desc">{now.text}</span>
          </div>
          <div className="wx-card-meta">
            {w.label && <>{w.label} · </>}
            {today && (
              <>
                H {today.high}° L {today.low}°
              </>
            )}
          </div>
        </div>
      </div>
      <div className="wx-card-hours">
        {w.hours.slice(0, 6).map((h) => (
          <div key={h.time} className="wx-card-hour">
            <span>{hourLabel(h.time)}</span>
            <WeatherIconSvg icon={describeWeather(h.code).icon} isDay={h.isDay} size="28" />
            <strong>{h.temp}°</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
