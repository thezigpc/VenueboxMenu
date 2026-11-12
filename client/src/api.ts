// HTTP helpers. The client is always served by the server (Vite proxies in dev). Paths are
// written from the root ("/api/...") and go through bgUrl, which adds the prefix the page
// runs under on a box or behind a proxy ("/menu/api/..."; SDK 0.10.0).

import { bgUrl } from "@bargames/sdk/client";
import type { AdminState, Settings, Slide } from "@menu/shared";

const TOKEN_KEY = "menu.adminToken";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: signed in until reload */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof Blob) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(bgUrl(path), { method, headers, body: payload, cache: "no-store" });
  } catch {
    throw new ApiError("Can't reach the server. Check the connection and try again.", 0);
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok) throw new ApiError(json?.error ?? `The server answered ${res.status}.`, res.status);
  return json as T;
}

export interface AuthStatus {
  setupNeeded: boolean;
  configured: boolean;
  broken: boolean;
  authenticated: boolean;
  minPasswordLength: number;
  /** On a box (kit 0.5.1): the box's admin password signs in; show the sign-in form first. */
  venueLogin?: boolean;
  /** Whether a (separate) menu password may be set now. False on a box unless staff. */
  setupAllowed?: boolean;
}

export const api = {
  status: () => request<AuthStatus>("GET", "/api/admin/status"),
  setup: (password: string) => request<{ token: string }>("POST", "/api/admin/setup", { password }),
  login: (password: string) => request<{ token: string }>("POST", "/api/admin/login", { password }),
  logout: () => request("POST", "/api/admin/logout", {}),
  state: () => request<AdminState>("GET", "/api/admin/state"),
  upload: (file: File) =>
    request<{ value: Slide }>("POST", "/api/admin/slides", file, { "x-filename": encodeURIComponent(file.name), "content-type": file.type || "application/octet-stream" }),
  updateSlide: (id: string, patch: Partial<Slide>) => request<{ value: Slide }>("PATCH", `/api/admin/slides/${encodeURIComponent(id)}`, patch),
  deleteSlide: (id: string) => request("DELETE", `/api/admin/slides/${encodeURIComponent(id)}`),
  reorder: (ids: string[]) => request<{ value: Slide[] }>("PUT", "/api/admin/order", { ids }),
  saveSettings: (patch: unknown) => request<{ value: Settings }>("PUT", "/api/admin/settings", patch),
  geocode: (q: string) =>
    request<{ results: { label: string; latitude: number; longitude: number; timezone: string | null }[] }>("GET", `/api/admin/geocode?q=${encodeURIComponent(q)}`),
};
