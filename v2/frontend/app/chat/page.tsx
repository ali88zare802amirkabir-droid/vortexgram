"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  getToken,
  setToken,
  ApiError,
  Me,
  Msg,
  RoomInfo,
  Group,
} from "../../lib/api";
import { connectSSE } from "../../lib/sse";
import ChatList, { roomTitle } from "../../components/ChatList";
import RoomView, { ReplyRef } from "../../components/RoomView";

function dmId(a: string, b: string): string {
  return "dm:" + [a, b].sort().join("|");
}

function forwardPayload(m: Msg): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (m.kind === "text" || m.kind === "sticker") {
    base.content = m.content;
  } else if (m.kind === "poll" && m.poll) {
    base.poll = {
      question: (m.poll as { question?: string }).question || "",
      options: (m.poll as { options?: string[] }).options || [],
    };
  } else if (m.kind === "checklist" && m.checklist) {
    base.checklist = {
      title: (m.checklist as { title?: string }).title || "",
      items: ((m.checklist as { items?: { text?: string }[] }).items || []).map((i) => i.text || ""),
    };
  } else if (m.kind === "album" && Array.isArray(m.album)) {
    base.album = m.album;
  } else {
    base.url = m.url;
    base.name = m.name;
    base.mime = m.mime;
    base.size = m.size;
  }
  base.fwdFrom = m.fwdFrom || m.from;
  return base;
}

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<Me[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [readState, setReadState] = useState<Record<string, Record<string, number>>>({});
  const [pinned, setPinned] = useState<Record<string, string[]>>({});
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Msg[]>>({});
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, { u: string; until: number }[]>>({});
  const [online, setOnline] = useState(true);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Me[]>([]);
  const [forwardMsg, setForwardMsg] = useState<Msg | null>(null);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [groupPanel, setGroupPanel] = useState(false);
  const [members, setMembers] = useState<{ username: string; role: string; display_name?: string }[]>([]);
  const [adminOpen, setAdminOpen] = useState(false);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const activeRef = useRef<string | null>(null);
  const meRef = useRef<string>("");
  const loadedRef = useRef<Record<string, boolean>>({});
  activeRef.current = active;
  if (me) meRef.current = me.username;

  const logout = useCallback(() => {
    setToken(null);
    router.push("/");
  }, [router]);

  const refreshRooms = useCallback(async () => {
    try {
      const d = await api<{ rooms: RoomInfo[] }>("/api/my-rooms");
      setRooms(d.rooms);
    } catch {
      /* ignore */
    }
  }, []);

  // ---- SSE event handling ----
  useEffect(() => {
    if (!getToken()) {
      router.push("/");
      return;
    }
    const onEvent = (type: string, data: Record<string, unknown>) => {
      if (type === "ready") {
        setMe(data.me as Me);
        setGroups((data.groups as Group[]) || []);
        setReadState((data.readState as Record<string, Record<string, number>>) || {});
        setPinned((data.pinned as Record<string, string[]>) || {});
        setUsers((data.users as Me[]) || []);
        refreshRooms();
        return;
      }
      if (type === "kicked") {
        logout();
        return;
      }
      if (type === "message") {
        const m = (data as { message: Msg }).message;
        if (!m) return;
        setMessages((prev) => {
          const arr = prev[m.roomId] || [];
          if (arr.some((x) => x.id === m.id)) return prev;
          // نسخه‌ی موقت (ارسال اپتیمیستیک) را با پیام قطعی سرور جایگزین کن
          const pi = arr.findIndex(
            (x) =>
              x.id.startsWith("tmp:") &&
              x.roomId === m.roomId &&
              x.from === meRef.current &&
              x.kind === m.kind &&
              x.content === m.content
          );
          if (pi >= 0) {
            const next = arr.slice();
            next[pi] = m;
            return { ...prev, [m.roomId]: next };
          }
          return { ...prev, [m.roomId]: [...arr, m] };
        });
        setRooms((prev) => {
          const ex = prev.find((r) => r.roomId === m.roomId);
          const isActive = m.roomId === activeRef.current;
          const unread = ex
            ? isActive || m.from === meRef.current
              ? ex.unread
              : ex.unread + 1
            : m.from === meRef.current
              ? 0
              : 1;
          const row: RoomInfo = { roomId: m.roomId, last: m, unread: isActive ? 0 : unread };
          return ex ? prev.map((r) => (r.roomId === m.roomId ? row : r)) : [...prev, row];
        });
        if (m.roomId === activeRef.current) markRead(m.roomId);
        return;
      }
      if (type === "message-updated") {
        const m = (data as { message: Msg }).message;
        if (!m) return;
        setMessages((prev) => ({
          ...prev,
          [m.roomId]: (prev[m.roomId] || []).map((x) => (x.id === m.id ? m : x)),
        }));
        setRooms((prev) =>
          prev.map((r) => (r.last?.id === m.id ? { ...r, last: m } : r))
        );
        return;
      }
      if (type === "message-edited") {
        const d = data as unknown as { id: string; roomId: string; content: string };
        setMessages((prev) => ({
          ...prev,
          [d.roomId]: (prev[d.roomId] || []).map((x) =>
            x.id === d.id ? { ...x, content: d.content, edited: true } : x
          ),
        }));
        return;
      }
      if (type === "message-deleted") {
        const d = data as unknown as { id: string; roomId: string };
        setMessages((prev) => ({
          ...prev,
          [d.roomId]: (prev[d.roomId] || []).filter((x) => x.id !== d.id),
        }));
        return;
      }
      if (type === "room-read") {
        const d = data as unknown as { roomId: string; username: string; time: number };
        setReadState((prev) => ({
          ...prev,
          [d.roomId]: { ...(prev[d.roomId] || {}), [d.username]: d.time },
        }));
        return;
      }
      if (type === "typing") {
        const d = data as unknown as { roomId: string; username: string; on: boolean };
        setTyping((prev) => {
          const arr = (prev[d.roomId] || []).filter((t) => t.u !== d.username && t.until > Date.now());
          if (d.on) arr.push({ u: d.username, until: Date.now() + 6000 });
          return { ...prev, [d.roomId]: arr };
        });
        return;
      }
      if (type === "pinned-updated") {
        const d = data as unknown as { roomId: string; ids: string[] };
        setPinned((prev) => ({ ...prev, [d.roomId]: d.ids }));
        return;
      }
      if (type === "users-changed") {
        setUsers(((data as { users?: Me[] }).users as Me[]) || []);
        return;
      }
      if (type === "groups-changed") {
        const g = (data as { groups?: Group[] }).groups as Group[];
        if (g) setGroups(g);
        else refreshRooms();
        return;
      }
    };
    const off = connectSSE({ onEvent, onStatus: setOnline });
    api<{ me: Me }>("/api/me")
      .then((d) => {
        setMe(d.me);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === 401) logout();
      });
    refreshRooms();
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markRead = async (roomId: string) => {
    try {
      await api("/api/read", { method: "POST", body: { roomId } });
      setRooms((prev) => prev.map((r) => (r.roomId === roomId ? { ...r, unread: 0 } : r)));
    } catch {
      /* ignore */
    }
  };

  const openRoom = async (roomId: string) => {
    setActive(roomId);
    setGroupPanel(false);
    if (!loadedRef.current[roomId]) {
      try {
        const d = await api<{ messages: Msg[] }>(
          "/api/history?room=" + encodeURIComponent(roomId) + "&limit=40"
        );
        loadedRef.current[roomId] = true;
        setMessages((prev) => ({ ...prev, [roomId]: d.messages }));
        setHasMore((prev) => ({ ...prev, [roomId]: d.messages.length >= 40 }));
      } catch {
        /* ignore */
      }
    }
    markRead(roomId);
  };

  const loadMore = async () => {
    if (!active) return;
    const arr = messages[active] || [];
    if (!arr.length) return;
    try {
      const d = await api<{ messages: Msg[] }>(
        "/api/history?room=" + encodeURIComponent(active) + "&limit=40&before=" + arr[0].time
      );
      if (d.messages.length) {
        setMessages((prev) => ({ ...prev, [active]: [...d.messages, ...(prev[active] || [])] }));
      }
      setHasMore((prev) => ({ ...prev, [active]: d.messages.length >= 40 }));
    } catch {
      /* ignore */
    }
  };

  const tempId = () =>
    "tmp:" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 7);

  const appendPending = (roomId: string, p: Msg) => {
    setMessages((prev) => ({ ...prev, [roomId]: [...(prev[roomId] || []), p] }));
    setRooms((prev) => prev.map((r) => (r.roomId === roomId ? { ...r, last: p } : r)));
  };
  const resolvePending = (roomId: string, tid: string, real: Msg) => {
    setMessages((prev) => ({
      ...prev,
      [roomId]: (prev[roomId] || []).map((x) => (x.id === tid ? real : x)),
    }));
    setRooms((prev) => prev.map((r) => (r.roomId === roomId ? { ...r, last: real } : r)));
  };
  const dropPending = (roomId: string, tid: string) => {
    setMessages((prev) => ({
      ...prev,
      [roomId]: (prev[roomId] || []).filter((x) => x.id !== tid),
    }));
  };

  const sendText = async (text: string, reply: ReplyRef | null) => {
    const roomId = active;
    if (!roomId) return;
    const id = tempId();
    appendPending(roomId, {
      id,
      roomId,
      from: meRef.current || "me",
      fromName: me?.displayName || meRef.current || "me",
      kind: "text",
      content: text,
      replyTo: reply ? { id: reply.id, name: reply.name, snippet: reply.snippet } : undefined,
      reactions: {},
      time: Date.now(),
      pending: true,
    });
    try {
      const d = await api<{ message: Msg }>("/api/messages", {
        method: "POST",
        body: {
          roomId,
          kind: "text",
          content: text,
          replyTo: reply ? { id: reply.id, name: reply.name, snippet: reply.snippet } : undefined,
        },
      });
      resolvePending(roomId, id, d.message);
    } catch (e) {
      dropPending(roomId, id);
      alert(e instanceof ApiError ? e.message : "ارسال ناموفق بود");
    }
  };

  const confirmSend = async (roomId: string, tid: string, kind: string, body: Record<string, unknown>) => {
    try {
      const d = await api<{ message: Msg }>("/api/messages", {
        method: "POST",
        body: Object.assign({ roomId, kind }, body),
      });
      resolvePending(roomId, tid, d.message);
      return true;
    } catch (e) {
      dropPending(roomId, tid);
      alert(e instanceof ApiError ? e.message : "ارسال ناموفق بود");
      return false;
    }
  };

  const sendFile = async (f: File) => {
    const roomId = active;
    if (!roomId) return;
    const id = tempId();
    appendPending(roomId, {
      id,
      roomId,
      from: meRef.current || "me",
      fromName: me?.displayName || meRef.current || "me",
      kind: f.type.startsWith("image/")
        ? "image"
        : f.type.startsWith("video/")
          ? "video"
          : f.type.startsWith("audio/")
            ? "audio"
            : "file",
      name: f.name,
      mime: f.type,
      size: f.size,
      content: "",
      reactions: {},
      time: Date.now(),
      pending: true,
    });
    const form = new FormData();
    form.append("file", f);
    try {
      const info = await api<{ url: string; mime: string; kind: string; name: string; size: number }>(
        "/api/upload",
        { method: "POST", form }
      );
      await confirmSend(roomId, id, info.kind, {
        url: info.url,
        mime: info.mime,
        name: info.name,
        size: info.size,
      });
    } catch (e) {
      dropPending(roomId, id);
      alert(e instanceof ApiError ? e.message : "آپلود ناموفق بود");
    }
  };

  const sendVoice = async (blob: Blob) => {
    const roomId = active;
    if (!roomId) return;
    const id = tempId();
    appendPending(roomId, {
      id,
      roomId,
      from: meRef.current || "me",
      fromName: me?.displayName || meRef.current || "me",
      kind: "voice",
      content: "",
      reactions: {},
      time: Date.now(),
      pending: true,
    });
    const form = new FormData();
    form.append("file", blob, "voice.webm");
    try {
      const info = await api<{ url: string; mime: string; name: string; size: number }>(
        "/api/upload",
        { method: "POST", form }
      );
      await confirmSend(roomId, id, "voice", {
        url: info.url,
        mime: info.mime,
        name: info.name,
        size: info.size,
      });
    } catch (e) {
      dropPending(roomId, id);
      alert(e instanceof ApiError ? e.message : "آپلود ناموفق بود");
    }
  };

  const doSearch = async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) {
      setFound([]);
      return;
    }
    try {
      const d = await api<{ users: Me[] }>("/api/users/search?q=" + encodeURIComponent(q));
      setFound(d.users.filter((u) => u.username !== me?.username));
    } catch {
      /* ignore */
    }
  };

  const startDm = (u: Me) => {
    if (!me) return;
    const id = dmId(me.username, u.username);
    setRooms((prev) =>
      prev.some((r) => r.roomId === id) ? prev : [...prev, { roomId: id, last: null, unread: 0 }]
    );
    setFound([]);
    setSearch("");
    openRoom(id);
  };

  const doForward = async (target: string) => {
    if (!forwardMsg || forwardMsg.pending || forwardBusy) return;
    setForwardBusy(true);
    const id = tempId();
    appendPending(target, {
      id,
      roomId: target,
      from: meRef.current || "me",
      fromName: me?.displayName || meRef.current || "me",
      kind: forwardMsg.kind,
      content: forwardMsg.content || "",
      name: forwardMsg.name,
      mime: forwardMsg.mime,
      size: forwardMsg.size,
      url: forwardMsg.url,
      fwdFrom: forwardMsg.fwdFrom || forwardMsg.from,
      poll: forwardMsg.poll,
      checklist: forwardMsg.checklist,
      album: forwardMsg.album,
      reactions: {},
      time: Date.now(),
      pending: true,
    });
    setForwardMsg(null);
    try {
      const d = await api<{ message: Msg }>("/api/messages", {
        method: "POST",
        body: Object.assign({ roomId: target, kind: forwardMsg.kind }, forwardPayload(forwardMsg)),
      });
      resolvePending(target, id, d.message);
    } catch (e) {
      dropPending(target, id);
      alert(e instanceof ApiError ? e.message : "فوروارد ناموفق بود");
    } finally {
      setForwardBusy(false);
    }
  };

  const createGroup = async () => {
    const name = prompt("نام گروه:");
    if (!name || name.trim().length < 2) return;
    try {
      const d = await api<{ group: Group }>("/api/groups", {
        method: "POST",
        body: { name: name.trim() },
      });
      setGroups((prev) => [...prev, d.group]);
      openRoom("group:" + d.group.id);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "خطا");
    }
  };

  const loadMembers = async () => {
    if (!active || !active.startsWith("group:")) return;
    try {
      const d = await api<{ members: { username: string; role: string; display_name?: string }[] }>(
        "/api/groups/" + active.slice(6) + "/members"
      );
      setMembers(d.members);
      setGroupPanel(true);
    } catch {
      /* ignore */
    }
  };

  const inviteLink = async () => {
    if (!active || !active.startsWith("group:")) return;
    try {
      const d = await api<{ link: string }>("/api/groups/" + active.slice(6) + "/invite");
      const full = window.location.origin.replace(/\/$/, "") + d.link;
      await navigator.clipboard.writeText(full);
      alert("لینک دعوت کپی شد:\n" + full);
    } catch {
      alert("خطا");
    }
  };

  const loadStats = async () => {
    try {
      const d = await api<Record<string, number>>("/api/admin/stats");
      setStats(d);
    } catch {
      /* ignore */
    }
  };

  if (!me) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">در حال اتصال…</p>
      </main>
    );
  }

  const title = active ? roomTitle(active, me, users, groups) : "";
  const typingNow = (typing[active || ""] || [])
    .filter((t) => t.until > Date.now())
    .map((t) => t.u);

  return (
    <main className="h-screen flex flex-col">
      <header className="glass flex items-center gap-2 px-3 py-2">
        <span className="font-extrabold">VORTEX</span>
        <span className={"text-[11px] px-2 py-0.5 rounded-full " + (online ? "bg-emerald-600" : "bg-rose-600")}>
          {online ? "متصل" : "قطع"}
        </span>
        <span className="mr-auto" />
        <button className="glass rounded-lg px-2 py-1 text-xs" onClick={createGroup}>
          گروه جدید +
        </button>
        {me.isAdmin && (
          <button
            className="glass rounded-lg px-2 py-1 text-xs"
            onClick={() => {
              setAdminOpen(!adminOpen);
              if (!adminOpen) loadStats();
            }}
          >
            ادمین
          </button>
        )}
        <button className="glass rounded-lg px-2 py-1 text-xs" onClick={logout}>
          خروج
        </button>
      </header>

      {adminOpen && (
        <div className="glass m-2 rounded-xl p-3 text-xs max-h-56 overflow-y-auto scroll-thin">
          <div className="font-bold mb-2">پنل ادمین {stats && <span className="text-gray-400">— کاربران: {stats.users} | پیام‌ها: {stats.messages} | گروه‌ها: {stats.groups} | آنلاین: {stats.online}</span>}</div>
          {users.map((u) => (
            <div key={u.username} className="flex items-center gap-2 py-1 border-b border-white/5">
              <span className="font-bold">{u.displayName}</span>
              <span className="text-gray-500">@{u.username}</span>
              {u.isAdmin && <span className="text-amber-300">ادمین</span>}
              {u.banned && <span className="text-rose-300">مسدود</span>}
              <span className="mr-auto" />
              <button
                className="glass rounded px-2 py-0.5"
                onClick={async () => {
                  await api("/api/admin/ban", { method: "POST", body: { username: u.username, banned: !u.banned } });
                  setUsers((prev) => prev.map((x) => (x.username === u.username ? { ...x, banned: !x.banned } : x)));
                }}
              >
                {u.banned ? "رفع مسدودی" : "مسدود"}
              </button>
              <button
                className="glass rounded px-2 py-0.5"
                onClick={async () => {
                  await api("/api/admin/premium", { method: "POST", body: { username: u.username, isPremium: !u.isPremium } });
                  setUsers((prev) => prev.map((x) => (x.username === u.username ? { ...x, isPremium: !x.isPremium } : x)));
                }}
              >
                {u.isPremium ? "لغو پرمیوم" : "پرمیوم"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="px-3 pt-2">
        <input
          className="input"
          placeholder="جستجوی کاربر برای شروع چت…"
          value={search}
          onChange={(e) => doSearch(e.target.value)}
        />
        {found.length > 0 && (
          <div className="glass rounded-xl mt-1 max-h-40 overflow-y-auto scroll-thin">
            {found.map((u) => (
              <button key={u.username} className="w-full text-right px-3 py-2 hover:bg-white/5" onClick={() => startDm(u)}>
                <span className="font-bold">{u.displayName}</span>{" "}
                <span className="text-xs text-gray-500">@{u.username}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 flex min-h-0 p-2 gap-2">
        <div className={"w-full md:w-80 shrink-0 glass rounded-2xl overflow-hidden " + (active ? "hidden md:block" : "block")}>
          <ChatList rooms={rooms} users={users} groups={groups} me={me} active={active} onOpen={openRoom} />
        </div>
        <div className={"flex-1 glass rounded-2xl overflow-hidden " + (active ? "block" : "hidden md:block")}>
          {active ? (
            <div className="h-full flex flex-col">
              {active.startsWith("group:") && (
                <div className="px-3 pt-2 flex gap-2 text-[11px]">
                  <button className="glass rounded-lg px-2 py-1" onClick={loadMembers}>
                    اعضا
                  </button>
                  <button className="glass rounded-lg px-2 py-1" onClick={inviteLink}>
                    لینک دعوت
                  </button>
                </div>
              )}
              {groupPanel && (
                <div className="m-2 glass rounded-xl p-2 text-xs max-h-32 overflow-y-auto scroll-thin">
                  <div className="flex justify-between mb-1">
                    <span className="font-bold">اعضای گروه</span>
                    <button onClick={() => setGroupPanel(false)}>✕</button>
                  </div>
                  {members.map((m) => (
                    <div key={m.username} className="py-0.5">
                      {m.display_name || m.username}{" "}
                      <span className="text-gray-500">({m.role})</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex-1 min-h-0">
                <RoomView
                  roomId={active}
                  title={title}
                  me={me}
                  messages={messages[active] || []}
                  typing={typingNow}
                  readState={readState}
                  pinned={pinned[active] || []}
                  hasMore={!!hasMore[active]}
                  onLoadMore={loadMore}
                  onSendText={sendText}
                  onSendFile={sendFile}
                  onSendVoice={sendVoice}
                  onEdit={(id, text) =>
                    api("/api/messages/" + id + "/edit", { method: "POST", body: { content: text } }).catch(() => {})
                  }
                  onDelete={(id) =>
                    api("/api/messages/" + id + "/delete", { method: "POST" }).catch(() => {})
                  }
                  onReact={(id, emoji) =>
                    api("/api/reactions", { method: "POST", body: { roomId: active, id, emoji } }).catch(() => {})
                  }
                  onTogglePin={(id, pin) => {
                    // بازخورد فوری بدون انتظار برای SSE
                    setPinned((prev) => {
                      const cur = prev[active] || [];
                      const next = pin
                        ? cur.filter((x) => x !== id)
                        : [id, ...cur.filter((x) => x !== id)].slice(0, 20);
                      return { ...prev, [active]: next };
                    });
                    api("/api/pin", { method: "POST", body: { roomId: active, id, pin: !pin } }).catch(() => {});
                  }}
                  onForward={(m) => setForwardMsg(m)}
                  onVote={(id, option) =>
                    api("/api/poll/vote", { method: "POST", body: { roomId: active, id, option } }).catch(() => {})
                  }
                  onCheck={(id, index) =>
                    api("/api/checklist/toggle", { method: "POST", body: { roomId: active, id, index } }).catch(() => {})
                  }
                  onTyping={(on) =>
                    api("/api/typing", { method: "POST", body: { roomId: active, on } }).catch(() => {})
                  }
                  onBack={() => setActive(null)}
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">
              یک گفتگو را انتخاب کن
            </div>
          )}
        </div>
      </div>

      {forwardMsg && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end md:items-center justify-center"
          onClick={() => setForwardMsg(null)}
        >
          <div
            className="w-full md:max-w-sm glass rounded-t-2xl md:rounded-2xl max-h-[70vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-white/10 flex justify-between items-center">
              <span className="font-bold text-sm">
                فوروارد به… {forwardBusy && <span className="text-[10px] text-gray-400">(در حال ارسال)</span>}
              </span>
              <button onClick={() => setForwardMsg(null)}>✕</button>
            </div>
            <div className="overflow-y-auto scroll-thin p-2">
              {rooms.length === 0 && (
                <div className="text-center text-xs text-gray-400 py-6">هیچ گفتگویی برای فوروارد نیست</div>
              )}
              {rooms.map((r) => (
                <button
                  key={r.roomId}
                  className="w-full text-right px-3 py-2 rounded-lg hover:bg-white/5 flex items-center gap-2"
                  onClick={() => doForward(r.roomId)}
                >
                  <span>{r.roomId.startsWith("group:") ? "👥" : "👤"}</span>
                  <span className="font-bold truncate">{roomTitle(r.roomId, me, users, groups)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
