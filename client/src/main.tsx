import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "@bargames/gamekit/client";
import { PhonePage } from "./pages/PhonePage";
import { TvPage } from "./pages/TvPage";
import { AdminPage } from "./pages/AdminPage";
import "./index.css";

// Three pages, one per path (bargames.json routes: player "/", table "/tv", host "/admin").
const path = location.pathname.replace(/\/+$/, "") || "/";
const isTv = path === "/tv";
const Page = isTv ? TvPage : path === "/admin" ? AdminPage : PhonePage;

function CrashScreen({ reload }: { reload: () => void }) {
  // A TV can't press a button: try again on its own.
  if (isTv) setTimeout(() => location.reload(), 10_000);
  return (
    <div className={isTv ? "tv-page" : "ph-page ad-center"}>
      {!isTv && (
        <>
          <h1>Something broke</h1>
          <p className="muted">Reloading usually fixes it.</p>
          <button className="primary" onClick={reload}>
            Reload
          </button>
        </>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={(_error, reload) => <CrashScreen reload={reload} />}>
      <Page />
    </ErrorBoundary>
  </React.StrictMode>,
);
