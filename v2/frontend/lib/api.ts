// Tiny typed client for the Vortex v2 PHP API.

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const TOKEN_KEY = "vx_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

export interface Me {
  username: string;
  displayName: string;
  isAdmin: boolean;
  isPremium: boolean;
  banned: boolean;
  avatar: string | null;
  bio: string;
  phone: string | null;
  blocked: string[];
  online?: boolean;
}

export interface Msg {
  id: string;
  roomId: string;
  from: string;
  fromName: string;
  kind: string;
  content: string;
  url?: string | null;
  mime?: string | null;
  name?: string | null;
  size?: number | null;
  replyTo?: { id: string; name?: string; snippet?: string } | null;
  poll?: unknown;
  checklist?: unknown;
  album?: unknown;
  fwdFrom?: string | null;
  reactions: Record<string, string[]>;
  time: number;
  edited?: boolean;
  pending?: boolean;
}

export interface RoomInfo {
  roomId: string;
  last: Msg | null;
  unread: number;
}

export interface Group {
  id: string;
  type: string;
  name: string;
  owner: string;
  members: number;
  myRole: string | null;
}

export async function api<T>(
  path: string,
  opts?: { method?: string; body?: unknown; form?: FormData }
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  let body: BodyInit | undefined;
  if (opts?.form) {
    body = opts.form;
  } else if (opts?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(API_URL + path, {
    method: opts?.method || "GET",
    headers,
    body,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : "خطای سرور (" + res.status + ")";
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export function fmtTime(t: number): string {
  try {
    return new Date(t).toLocaleTimeString("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function previewText(m: Msg): string {
  if (m.kind === "image") return "تصویر";
  if (m.kind === "video") return "ویدیو";
  if (m.kind === "file") return "فایل" + (m.name ? ": " + m.name : "");
  if (m.kind === "audio" || m.kind === "voice") return "پیام صوتی";
  if (m.kind === "sticker") return "استیکر";
  if (m.kind === "poll") return "نظرسنجی";
  if (m.kind === "checklist") return "چک‌لیست";
  return (m.content || "").slice(0, 60);
}
