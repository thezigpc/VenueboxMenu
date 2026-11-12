import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the client runs on :5175 and talks to the server on :3005 (see src/api.ts).
// Slide images are proxied so <img src="/slides/..."> works on the dev port too.
export default defineConfig({
  // Relative asset URLs, so the built page works at the root and under a prefix (/menu/;
  // the server injects <base href="/menu/">).
  base: "./",
  plugins: [react()],
  server: {
    host: true,
    port: 5175,
    proxy: {
      "/slides": "http://localhost:3005",
      "/api": "http://localhost:3005",
      "/__bargames": "http://localhost:3005",
    },
  },
});
