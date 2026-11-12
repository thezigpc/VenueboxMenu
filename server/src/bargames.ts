// The module's single connection to a Bar Games box (see BARGAMES.md).
//
// Off a box (no BG_CORE_URL / BG_GAME_TOKEN env) every call here is a no-op and the
// module runs exactly as it does standalone: that's guaranteed by the SDK.
//
// An app (a screen for the venue, not a game) has no rooms, players, events or commands: level 1 is the venue's
// name, colors, location, time zone and units, plus an empty status for the box.

import { createBarGames, type BarGames } from "@bargames/sdk/server";
import type { Location, Units } from "@menu/shared";
import { log } from "@bargames/gamekit/server";

export function makeBarGames(opts: { coreUrl?: string; token?: string; defaultName: string }): BarGames {
  const bg = createBarGames({ gameId: "menu", defaultName: opts.defaultName, coreUrl: opts.coreUrl, token: opts.token });
  // The box asks every package for status; an app has no rooms to list.
  bg.setStatusProvider(() => ({ rooms: [] }));
  return bg;
}

/** What the box knows about the venue that the menu uses (all optional, SDK 0.5.0+). */
export interface VenueFacts {
  name: string;
  location: Location | null;
  timezone: string | null;
  units: Units | null;
}

/** The venue's facts on a box; null standalone or when the box can't be reached. */
export async function venueFacts(bg: BarGames): Promise<VenueFacts | null> {
  if (!bg.connected) return null;
  try {
    const ctx = await bg.venue();
    const v = ctx.venue;
    const loc = v.location;
    return {
      name: ctx.game.displayName,
      location:
        loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)
          ? { latitude: loc.latitude, longitude: loc.longitude, ...(loc.label ? { label: loc.label } : {}) }
          : null,
      timezone: v.timezone || null,
      units: v.units === "imperial" || v.units === "metric" ? v.units : null,
    };
  } catch (err) {
    log.warn("bargames", "venue context unavailable", { err: String(err) });
    return null;
  }
}
