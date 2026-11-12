// /: the menu on a guest's phone. The same slides as the TVs, what's on now first, then
// what's on later (with when), the weather, and on a box the venue's extras.

import { BackToGames, useGameName, VenueAnnouncement } from "@bargames/gamekit/client";
import { basePath, bgUrl, isOnBox } from "@bargames/sdk/client";
import { activeSlides, describeSchedule, DEFAULT_NAME, type PublicSlide } from "@menu/shared";
import { useNow, usePlaylist } from "../usePlaylist";
import { useVenue } from "../useVenue";
import { WeatherCard } from "../Weather";

function SlideImage({ slide }: { slide: PublicSlide }) {
  return (
    <a className="ph-slide" href={bgUrl(slide.url)} target="_blank" rel="noreferrer">
      <img src={bgUrl(slide.url)} alt={slide.title} width={slide.width} height={slide.height} loading="lazy" decoding="async" />
    </a>
  );
}

export function PhonePage() {
  const { playlist, loaded, clockOffset } = usePlaylist({ intervalMs: 30_000 });
  const venue = useVenue();
  const name = useGameName(basePath(), playlist?.name || DEFAULT_NAME);
  const now = useNow(30_000, clockOffset);
  const logo = isOnBox(venue) ? venue.game.theme.logoUrl : undefined;

  const on = playlist ? activeSlides(playlist, now) : [];
  const onIds = new Set(on.map((s) => s.id));
  const later = playlist ? playlist.slides.filter((s) => !onIds.has(s.id)) : [];

  return (
    <div className="ph-page">
      <VenueAnnouncement ctx={venue} />
      <header className="ph-header">
        {logo && <img className="ph-logo" src={logo} alt="" />}
        <h1>{name}</h1>
      </header>

      <main className="ph-main">
        {playlist?.weather && <WeatherCard weather={playlist.weather.data} />}

        {on.length > 0 && (
          <section className="ph-section" aria-label="On now">
            {later.length > 0 && <h2>On now</h2>}
            {on.map((s) => (
              <SlideImage key={s.id} slide={s} />
            ))}
          </section>
        )}

        {later.length > 0 && (
          <section className="ph-section" aria-label="Later">
            <h2>Later</h2>
            {later.map((s) => (
              <figure key={s.id} className="ph-later">
                <figcaption>{describeSchedule(s.schedule)}</figcaption>
                <SlideImage slide={s} />
              </figure>
            ))}
          </section>
        )}

        {playlist && playlist.slides.length === 0 && (
          <div className="ph-empty">
            <p className="ph-empty-title">Menu coming soon</p>
            <p className="muted">Check back in a little while.</p>
          </div>
        )}
        {!playlist && loaded === false && <p className="muted ph-loading">Loading the menu…</p>}
      </main>

      <footer className="ph-footer">
        <BackToGames ctx={venue} />
      </footer>
    </div>
  );
}
