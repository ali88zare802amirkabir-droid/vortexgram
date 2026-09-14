// SSE realtime client: takes a short-lived ticket, opens the stream,
// resumes from the last event id, and auto-reconnects with backoff.

"use client";

import { API_URL, getToken } from "./api";

const LAST_LEGACY_KEY = "vx_sse_last";

export const SSE_TYPES = [
  "ready",
  "message",
  "message-updated",
  "message-edited",
  "message-deleted",
  "room-read",
  "typing",
  "pinned-updated",
  "users-changed",
  "groups-changed",
  "peer-changed",
  "kicked",
];

export type SSEHandlers = {
  onEvent: (type: string, data: Record<string, unknown>, id: number) => void;
  onStatus?: (online: boolean) => void;
};

export function connectSSE(handlers: SSEHandlers): () => void {
  let es: EventSource | null = null;
  let stopped = false;
  let backoff = 2000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = async () => {
    if (stopped) return;
    try {
      const token = getToken();
      if (!token) throw new Error("no token");
      // last-seen event id به ازای هر نشست جدا می‌ماند تا اکانت/تب‌های مختلف همدیگر را
      // خراب نکنند (در localStorage مشترک مرورگر).
      const key = "vx_sse_last:" + token;
      try {
        localStorage.removeItem(LAST_LEGACY_KEY);
      } catch {
        /* noop */
      }
      const tr = await fetch(API_URL + "/api/stream-ticket", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      if (!tr.ok) throw new Error("ticket " + tr.status);
      const tj = (await tr.json()) as { ticket?: string };
      if (!tj.ticket) throw new Error("no ticket");
      let last = parseInt(localStorage.getItem(key) || "0", 10) || 0;
      es = new EventSource(
        API_URL + "/api/stream?ticket=" + tj.ticket + "&last_id=" + last
      );
      const dispatch = (type: string) => (ev: MessageEvent) => {
        try {
          const id = parseInt((ev as MessageEvent).lastEventId || "0", 10) || 0;
          const data = ev.data ? JSON.parse(ev.data) : {};
          if (id > 0) localStorage.setItem(key, String(id));
          if (type === "ready" && id === 0) {
            const serverMax =
              Number((data as { maxEventId?: number }).maxEventId ?? 0) || 0;
            last = parseInt(localStorage.getItem(key) || "0", 10) || 0;
            if (last > serverMax) {
              // دیتابیس سرور ریست شده؛ با مقدار تازه دوباره متصل شو تا از گرسنگی رویداد نجات یابیم.
              localStorage.setItem(key, String(serverMax));
              try {
                es?.close();
              } catch {
                /* noop */
              }
              es = null;
              if (!stopped) {
                if (timer) clearTimeout(timer);
                timer = setTimeout(open, 500);
              }
            }
          }
          handlers.onEvent(type, data, id);
        } catch {
          /* ignore malformed frames */
        }
      };
      SSE_TYPES.forEach((t) => es!.addEventListener(t, dispatch(t) as EventListener));
      es.onopen = () => {
        backoff = 2000;
        handlers.onStatus?.(true);
      };
      es.onerror = () => {
        handlers.onStatus?.(false);
        try { es?.close(); } catch { /* noop */ }
        es = null;
        if (!stopped) {
          timer = setTimeout(open, backoff);
          backoff = Math.min(backoff * 2, 15000);
        }
      };
    } catch {
      handlers.onStatus?.(false);
      if (!stopped) {
        timer = setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 15000);
      }
    }
  };

  open();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    try { es?.close(); } catch { /* noop */ }
  };
}
