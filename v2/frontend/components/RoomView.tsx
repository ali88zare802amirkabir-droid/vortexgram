"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL, Me, Msg, fmtTime, previewText } from "../lib/api";

const QUICK_EMOJI = ["❤️", "👍", "😂", "😮", "😢", "🔥"];

export interface ReplyRef {
  id: string;
  name: string;
  snippet: string;
}

function readByOther(
  m: Msg,
  roomId: string,
  me: string,
  readState: Record<string, Record<string, number>>
): boolean {
  const rs = readState[roomId] || {};
  return Object.entries(rs).some(([u, t]) => u !== me && t >= m.time);
}

function Bubble(props: {
  m: Msg;
  me: Me;
  read: boolean;
  pinned: boolean;
  highlighted?: boolean;
  msgById: Record<string, Msg>;
  repliedBy?: Msg | null;
  onReply: (m: Msg) => void;
  onEdit: (m: Msg) => void;
  onDelete: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onForward: (m: Msg) => void;
  onJumpReply: (id: string) => void;
  onVote: (id: string, option: number) => void;
  onCheck: (id: string, index: number) => void;
}) {
  const { m, me, read } = props;
  const mine = m.from === me.username;
  const rt = m.replyTo;
  const rb = props.repliedBy;
  const effectiveSnippet =
    rt && (rt.snippet || "").trim()
      ? rt.snippet
      : rt && props.msgById[rt.id]
        ? previewText(props.msgById[rt.id])
        : "";
  const [showActs, setShowActs] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);

  const mediaUrl = m.url ? API_URL + m.url : "";

  return (
    <div
      id={"msg-" + m.id}
      className={
        "flex scroll-mt-24 transition-all duration-500 " +
        (mine ? "justify-start" : "justify-end") +
        (props.highlighted ? " " : "")
      }
    >
      <div
        className={
          "max-w-[80%] rounded-2xl px-3 py-2 transition-shadow " +
          (m.pending ? "opacity-70 " : "") +
          (props.highlighted ? " ring-2 ring-violet-400/80 shadow-lg shadow-violet-500/20 " : "") +
          (mine ? "bubble-mine" : "bubble-theirs")
        }
      >
        {m.pending && <div className="text-[10px] text-gray-400 mb-0.5">در حال ارسال…</div>}
        {m.fwdFrom && (
          <div className="text-[10px] text-gray-400 mb-0.5">فوروارد شده از @{m.fwdFrom}</div>
        )}
        {!mine && !m.pending && <div className="text-[11px] font-bold text-cyan-300">{m.fromName}</div>}
        {rt && (
          <button
            className="block w-full text-left text-[11px] opacity-90 border-r-2 border-cyan-400/60 pr-2 mb-1 hover:opacity-100 hover:border-violet-400"
            onClick={() => props.onJumpReply(rt.id)}
            title="پرش به پیام اصلی"
          >
            <span className="text-cyan-300/90">پاسخ به {rt.name || "پیام"}: </span>
            {effectiveSnippet || ""}
          </button>
        )}
        {m.kind === "text" ? (
          <div className="whitespace-pre-wrap break-words text-[15px]">{m.content}</div>
        ) : null}
        {m.kind === "sticker" ? (
          m.content ? (
            <img
              src={m.content.startsWith("http") ? m.content : API_URL + m.content}
              alt=""
              loading="lazy"
              className="rounded-xl max-h-40"
            />
          ) : null
        ) : null}
        {m.kind === "image" || m.kind === "gif" ? (
          m.pending || !m.url ? (
            <div className="text-xs opacity-70">افزودن تصویر…</div>
          ) : (
            <img src={mediaUrl} alt="" loading="lazy" className="rounded-xl max-h-64" />
          )
        ) : null}
        {m.kind === "video" ? (
          m.pending || !m.url ? (
            <div className="text-xs opacity-70">افزودن ویدیو…</div>
          ) : (
            <video src={mediaUrl} controls className="rounded-xl max-h-64" />
          )
        ) : null}
        {m.kind === "audio" || m.kind === "voice" ? (
          m.pending || !m.url ? (
            <div className="text-xs opacity-70">ضبط در حال ارسال…</div>
          ) : (
            <audio src={mediaUrl} controls className="max-w-full" />
          )
        ) : null}
        {m.kind === "file" ? (
          m.pending || !m.url ? (
            <div className="text-xs opacity-70">{m.name || "آپلود فایل…"}</div>
          ) : (
            <a href={mediaUrl} download className="underline text-sm">
              {m.name || "دانلود فایل"}
            </a>
          )
        ) : null}
        {m.kind === "poll" && m.poll ? (
          <PollView
            poll={m.poll as { question: string; options: string[]; votes?: Record<string, string[]> }}
            me={me.username}
            onVote={(o) => props.onVote(m.id, o)}
          />
        ) : null}
        {m.kind === "checklist" && m.checklist ? (
          <ChecklistView
            list={m.checklist as { title: string; items: { text: string; done: boolean }[] }}
            onCheck={(i) => props.onCheck(m.id, i)}
          />
        ) : null}

        {Object.keys(m.reactions || {}).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(m.reactions).map(([em, users]) => (
              <button
                key={em}
                onClick={() => props.onReact(m.id, em)}
                className={
                  "text-xs rounded-full px-2 py-0.5 border " +
                  (users.includes(me.username)
                    ? "border-violet-400 bg-violet-500/20"
                    : "border-white/10 bg-black/20")
                }
              >
                {em} {users.length > 1 ? users.length : ""}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-1 text-[10px] opacity-70">
          <span>{fmtTime(m.time)}</span>
          {m.edited && <span>(ویرایش شد)</span>}
          {props.pinned && <span title="سنجاق شده">📌</span>}
          {mine && <span>{m.pending ? "⏳" : read ? "✓✓" : "✓"}</span>}
          {rb && (
            <button
              onClick={() => props.onJumpReply(rb.id)}
              className="text-cyan-300/90 hover:underline hover:opacity-100"
              title="پرش به پاسخ"
            >
              ↩ {rb.from === me.username ? "شما" : rb.fromName}
            </button>
          )}
          <button onClick={() => setShowActs(!showActs)} className="mr-auto opacity-70">
            ⋮
          </button>
        </div>

        {showActs && (
          <div className="flex flex-wrap gap-1 mt-1 text-[11px]">
            <button className="glass rounded-lg px-2 py-1" onClick={() => props.onReply(m)}>
              پاسخ
            </button>
            <button className="glass rounded-lg px-2 py-1" onClick={() => props.onForward(m)}>
              فوروارد
            </button>
            <button className="glass rounded-lg px-2 py-1" onClick={() => setShowEmoji(!showEmoji)}>
              واکنش
            </button>
            {mine && (
              <button className="glass rounded-lg px-2 py-1" onClick={() => props.onEdit(m)}>
                ویرایش
              </button>
            )}
            <button
              className="glass rounded-lg px-2 py-1"
              onClick={() => props.onTogglePin(m.id, props.pinned)}
            >
              {props.pinned ? "برداشتن پین" : "پین"}
            </button>
            <button
              className="glass rounded-lg px-2 py-1 text-rose-300"
              onClick={() => props.onDelete(m.id)}
            >
              حذف
            </button>
          </div>
        )}
        {showEmoji && (
          <div className="flex gap-1 mt-1">
            {QUICK_EMOJI.map((e) => (
              <button
                key={e}
                className="text-lg"
                onClick={() => {
                  props.onReact(m.id, e);
                  setShowEmoji(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PollView(props: {
  poll: { question: string; options: string[]; votes?: Record<string, string[]> };
  me: string;
  onVote: (o: number) => void;
}) {
  const votes = props.poll.votes || {};
  const total = Object.values(votes).reduce((s, a) => s + a.length, 0);
  return (
    <div className="min-w-[200px]">
      <div className="font-bold text-sm mb-1">{props.poll.question}</div>
      {props.poll.options.map((o, i) => {
        const c = (votes[String(i)] || []).length;
        const pct = total ? Math.round((c / total) * 100) : 0;
        return (
          <button
            key={i}
            onClick={() => props.onVote(i)}
            className="w-full text-right text-xs rounded-lg bg-black/25 px-2 py-1.5 mb-1"
          >
            <span className="flex justify-between">
              <span>{o}</span>
              <span className="opacity-70">{pct}٪</span>
            </span>
            <span className="block h-1 rounded bg-white/10 mt-1">
              <span className="block h-1 rounded bg-cyan-400" style={{ width: pct + "%" }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChecklistView(props: {
  list: { title: string; items: { text: string; done: boolean }[] };
  onCheck: (i: number) => void;
}) {
  return (
    <div className="min-w-[200px]">
      <div className="font-bold text-sm mb-1">{props.list.title}</div>
      {props.list.items.map((it, i) => (
        <button
          key={i}
          onClick={() => props.onCheck(i)}
          className="w-full text-right text-xs rounded-lg bg-black/25 px-2 py-1.5 mb-1 flex gap-2"
        >
          <span>{it.done ? "☑" : "☐"}</span>
          <span className={it.done ? "line-through opacity-60" : ""}>{it.text}</span>
        </button>
      ))}
    </div>
  );
}

export default function RoomView(props: {
  roomId: string;
  title: string;
  me: Me;
  messages: Msg[];
  typing: string[];
  readState: Record<string, Record<string, number>>;
  pinned: string[];
  hasMore: boolean;
  onLoadMore: () => void;
  onSendText: (text: string, reply: ReplyRef | null) => void;
  onSendFile: (f: File) => void;
  onSendVoice: (blob: Blob) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onForward: (m: Msg) => void;
  onVote: (id: string, option: number) => void;
  onCheck: (id: string, index: number) => void;
  onTyping: (on: boolean) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState<ReplyRef | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastTypeRef = useRef(0);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  const jumpTo = (id: string) => {
    const el = document.getElementById("msg-" + id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2400);
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [props.messages, props.typing]);

  useEffect(() => {
    setText("");
    setReply(null);
    setEditing(null);
  }, [props.roomId]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    if (editing) {
      props.onEdit(editing.id, t);
      setEditing(null);
    } else {
      props.onSendText(t, reply);
      setReply(null);
    }
    setText("");
    props.onTyping(false);
  };

  const onInput = (v: string) => {
    setText(v);
    const now = Date.now();
    if (now - lastTypeRef.current > 3000) {
      lastTypeRef.current = now;
      props.onTyping(true);
    }
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size > 1000) props.onSendVoice(blob);
        setRecording(false);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert("دسترسی به میکروفون ممکن نیست");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-white/10 flex items-center gap-2">
        <button className="md:hidden glass rounded-lg px-2 py-1" onClick={props.onBack}>
          →
        </button>
        <div className="font-extrabold truncate">{props.title}</div>
        {props.typing.length > 0 && (
          <div className="text-[11px] text-cyan-300">در حال نوشتن…</div>
        )}
      </div>

      {props.pinned.length > 0 && !props.typing.length && (() => {
        const pm = props.messages.find((x) => x.id === props.pinned[0]);
        return pm ? (
          <div className="px-3 py-1 border-b border-white/10 text-[11px] text-amber-200/90 flex items-center gap-2 truncate">
            <span>📌</span>
            <span className="truncate">{pm.from === props.me.username ? "شما: " : pm.fromName + ": "}{previewText(pm)}</span>
          </div>
        ) : null;
      })()}

      <div ref={boxRef} className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2">
        {props.hasMore && (
          <button
            className="mx-auto block text-xs glass rounded-full px-4 py-1"
            onClick={props.onLoadMore}
          >
            پیام‌های قدیمی‌تر
          </button>
        )}
        {(() => {
          const msgById: Record<string, Msg> = {};
          const repliedTo: Record<string, Msg> = {};
          for (const m of props.messages) {
            msgById[m.id] = m;
            if (m.replyTo?.id) repliedTo[m.replyTo.id] = m;
          }
          return props.messages.map((m) => (
            <Bubble
              key={m.id}
              m={m}
              me={props.me}
              read={readByOther(m, props.roomId, props.me.username, props.readState)}
              pinned={props.pinned.includes(m.id)}
              highlighted={m.id === highlightId}
              msgById={msgById}
              repliedBy={repliedTo[m.id]}
              onJumpReply={jumpTo}
              onReply={(x) =>
                setReply({
                  id: x.id,
                  name: x.fromName,
                  snippet: previewText(x) || (x.content || "").slice(0, 80),
                })
              }
            onEdit={(x) => {
              setEditing({ id: x.id, text: x.content });
              setText(x.content);
            }}
            onDelete={(id) => {
              if (confirm("حذف شود؟")) props.onDelete(id);
            }}
            onReact={props.onReact}
            onTogglePin={props.onTogglePin}
            onForward={props.onForward}
            onVote={props.onVote}
            onCheck={props.onCheck}
          />
          ));
        })()}
      </div>

      <div className="p-2 border-t border-white/10">
        {reply && (
          <div className="text-[11px] text-gray-300 glass rounded-lg px-2 py-1 mb-1 flex justify-between">
            <span>پاسخ به {reply.name}: {reply.snippet}</span>
            <button onClick={() => setReply(null)}>✕</button>
          </div>
        )}
        {editing && (
          <div className="text-[11px] text-amber-300 glass rounded-lg px-2 py-1 mb-1 flex justify-between">
            <span>در حال ویرایش…</span>
            <button
              onClick={() => {
                setEditing(null);
                setText("");
              }}
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <button className="glass rounded-xl px-3" onClick={() => fileRef.current?.click()}>
            📎
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onSendFile(f);
              e.target.value = "";
            }}
          />
          <button
            className={"glass rounded-xl px-3 " + (recording ? "text-rose-400" : "")}
            onClick={() => (recording ? recRef.current?.stop() : startRec())}
          >
            {recording ? "⏹" : "🎙"}
          </button>
          <input
            className="input flex-1"
            placeholder="پیام…"
            value={text}
            onChange={(e) => onInput(e.target.value)}
            onBlur={() => props.onTyping(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn-acc" onClick={send}>
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
