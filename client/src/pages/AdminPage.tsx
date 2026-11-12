// /admin: staff sign in (the kit's admin password), upload and arrange slides, set the
// weather, and watch a live preview of the TV.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { VenueAnnouncement } from "@bargames/gamekit/client";
import type { AdminState } from "@menu/shared";
import { api, ApiError, getToken, setToken, type AuthStatus } from "../api";
import { useVenue } from "../useVenue";
import { SlidesPanel } from "../admin/SlidesPanel";
import { SettingsPanel } from "../admin/SettingsPanel";

type Phase = { kind: "loading" } | { kind: "auth"; status: AuthStatus } | { kind: "ready" } | { kind: "offline"; message: string };

function AuthForm({ status, onDone }: { status: AuthStatus; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const setup = status.setupNeeded;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (setup && password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    try {
      const r = setup ? await api.setup(password) : await api.login(password);
      setToken(r.token);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  if (status.broken) {
    return (
      <div className="ad-auth card">
        <h1>Menu admin</h1>
        <p className="error">The admin password file on the server is damaged. Ask whoever runs the server to fix or delete admin.json in the data folder.</p>
      </div>
    );
  }
  return (
    <form className="ad-auth card" onSubmit={submit}>
      <h1>Menu admin</h1>
      {setup ? (
        <p className="muted">
          Choose the admin password. Whoever sets it first becomes the admin, so do this now. At least {status.minPasswordLength} characters.
        </p>
      ) : (
        <p className="muted">Sign in to change the menu.</p>
      )}
      <label>
        Password
        <input type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
      </label>
      {setup && (
        <label>
          Password again
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !password}>
        {setup ? "Set password" : "Sign in"}
      </button>
    </form>
  );
}

export function AdminPage() {
  const venue = useVenue();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [state, setState] = useState<AdminState | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const check = useCallback(async () => {
    try {
      const status = await api.status();
      if (status.authenticated && getToken()) {
        setPhase({ kind: "ready" });
        setState(await api.state());
      } else {
        setToken("");
        setPhase({ kind: "auth", status });
      }
    } catch (err) {
      setPhase({ kind: "offline", message: err instanceof Error ? err.message : "Can't reach the server." });
    }
  }, []);

  useEffect(() => {
    document.title = "Menu admin";
    void check();
  }, [check]);

  /** Re-reads everything; signs out if the session expired. */
  const reload = useCallback(async () => {
    try {
      setState(await api.state());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return void check();
      setNotice({ text: err instanceof Error ? err.message : "Couldn't load.", error: true });
    }
  }, [check]);

  /** Runs an admin action, shows its error, and reloads. */
  const act = useCallback(
    async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
      try {
        await fn();
        if (ok) setNotice({ text: ok, error: false });
        await reload();
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          void check();
          return false;
        }
        setNotice({ text: err instanceof Error ? err.message : "That didn't work.", error: true });
        await reload();
        return false;
      }
    },
    [check, reload],
  );

  useEffect(() => {
    if (!notice || notice.error) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    setToken("");
    void check();
  };

  return (
    <div className="ad-page">
      <VenueAnnouncement ctx={venue} />
      {phase.kind === "loading" && <p className="muted ad-center">Loading…</p>}
      {phase.kind === "offline" && (
        <div className="ad-auth card">
          <h1>Menu admin</h1>
          <p className="error">{phase.message}</p>
          <button onClick={() => void check()}>Try again</button>
        </div>
      )}
      {phase.kind === "auth" && <AuthForm status={phase.status} onDone={() => void check()} />}
      {phase.kind === "ready" && (
        <>
          <header className="ad-header">
            <h1>Menu admin</h1>
            <nav>
              <a href="/tv" target="_blank" rel="noreferrer">
                TV view
              </a>
              <a href="/" target="_blank" rel="noreferrer">
                Phone view
              </a>
              <button className="link" onClick={() => void signOut()}>
                Sign out
              </button>
            </nav>
          </header>
          {notice && (
            <div className={`ad-notice${notice.error ? " is-error" : ""}`} role="status">
              <span>{notice.text}</span>
              <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss">
                ×
              </button>
            </div>
          )}
          {!state ? (
            <p className="muted ad-center">Loading…</p>
          ) : (
            <div className="ad-grid">
              <div className="ad-col">
                <SlidesPanel state={state} act={act} setNotice={setNotice} reload={reload} />
              </div>
              <div className="ad-col">
                <section className="card">
                  <h2>Preview</h2>
                  <div className="ad-preview">
                    <iframe src="/tv?preview=1" title="TV preview" tabIndex={-1} />
                  </div>
                  <p className="muted small">What the TVs show, live. Changes reach the TVs within a few seconds.</p>
                </section>
                <SettingsPanel state={state} act={act} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
