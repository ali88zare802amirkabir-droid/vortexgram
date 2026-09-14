"use client";

import { Me, Group, RoomInfo, previewText, fmtTime } from "../lib/api";

function otherOf(roomId: string, me: string): string {
  const inner = roomId.slice(3);
  const ps = inner.split("|");
  return ps.find((p) => p !== me) || inner;
}

export function roomTitle(
  roomId: string,
  me: Me,
  users: Me[],
  groups: Group[]
): string {
  if (roomId.startsWith("group:")) {
    const g = groups.find((x) => "group:" + x.id === roomId);
    return g ? g.name : "گروه";
  }
  const other = otherOf(roomId, me.username);
  if (other === "vortex_bot") return "Vortex AI";
  const u = users.find((x) => x.username === other);
  return u ? u.displayName : other;
}

export default function ChatList(props: {
  rooms: RoomInfo[];
  users: Me[];
  groups: Group[];
  me: Me;
  active: string | null;
  onOpen: (roomId: string) => void;
}) {
  const { rooms, users, groups, me, active, onOpen } = props;
  const sorted = [...rooms].sort(
    (a, b) => (b.last?.time || 0) - (a.last?.time || 0)
  );
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 font-extrabold text-lg">گفتگوها</div>
      <div className="flex-1 overflow-y-auto scroll-thin">
        {sorted.length === 0 && (
          <p className="text-center text-sm text-gray-500 p-6">
            هنوز چتی نیست — از بات شروع کن
          </p>
        )}
        {sorted.map((r) => {
          const title = roomTitle(r.roomId, me, users, groups);
          const isGroup = r.roomId.startsWith("group:");
          const other = !isGroup ? otherOf(r.roomId, me.username) : "";
          const u = !isGroup ? users.find((x) => x.username === other) : null;
          const online = u?.online || other === "vortex_bot";
          return (
            <button
              key={r.roomId}
              onClick={() => onOpen(r.roomId)}
              className={
                "w-full text-right px-3 py-2.5 flex items-center gap-3 hover:bg-white/5 " +
                (active === r.roomId ? "bg-white/5" : "")
              }
            >
              <span className="relative w-10 h-10 rounded-full bg-gradient-to-br from-violet-600 to-cyan-500 flex items-center justify-center font-bold shrink-0">
                {title.slice(0, 1)}
                {online && (
                  <span className="absolute bottom-0 left-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0b0f1a]" />
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-bold truncate">{title}</span>
                  <span className="text-[11px] text-gray-500 shrink-0">
                    {r.last ? fmtTime(r.last.time) : ""}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {r.last
                      ? (r.last.from === me.username ? "شما: " : "") + previewText(r.last)
                      : "چت را شروع کنید"}
                  </span>
                  {r.unread > 0 && (
                    <span className="text-[11px] bg-violet-600 rounded-full px-2 py-0.5 shrink-0">
                      {r.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
