export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("pulse_token");
}

export function setToken(token: string) {
  localStorage.setItem("pulse_token", token);
}

export function clearToken() {
  localStorage.removeItem("pulse_token");
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {
    ...authHeaders(),
    ...(init?.headers as Record<string, string> || {}),
  };
  return fetch(url, { ...init, headers });
}
