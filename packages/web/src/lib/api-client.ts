import { auth } from "./firebase";

/** Hono API（/api/**）への認証付きfetchラッパー。IDトークンをAuthorizationヘッダに付与する */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  const idToken = user ? await user.getIdToken() : null;

  const headers = new Headers(init.headers);
  if (idToken) {
    headers.set("Authorization", `Bearer ${idToken}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: "GET" });
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: "PATCH", body: JSON.stringify(body) });
  return res.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: "DELETE" });
  return res.json() as Promise<T>;
}
