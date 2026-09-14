// Vortex v2 — خودآزمایی بک‌اند بدون نصب PHP.
//
// کل بک‌اند را با PHP-WASM (php. Wasm کامپایل‌شده برای Node) اجرا می‌کند:
// ۳۰ سناریوی real-request (ثبت‌نام/ورود/ارسال/هیستوری/گروه/نظرسنجی/چک‌لیست/
// rate-limit/دسترسی) را زده و HEADER های امنیتی را هم چک می‌کند.
//
// اجرا:
//   cd v2/tools
//   npm init -y   (فقط یک‌بار، اگر tools/package.json نداری)
//   npm i @php-wasm/node
//   node smoke-phpwasm.mjs
//
// دیتابیس تست در پوشه‌ی موقت ساخته می‌شود و بعد از اتمام پاک می‌شود؛
// چیزی از پروژه‌ی واقعی را آلوده نمی‌کند.

import { loadNodeRuntime, createNodeFsMountHandler } from "@php-wasm/node";
import { PHP, PHPRequestHandler } from "@php-wasm/universal";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const THIS_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"));
const SRC = path.resolve(THIS_DIR, "..", "backend");

if (!fs.existsSync(path.join(SRC, "public", "index.php"))) {
  console.error("backend/ یافت نشد. اسکریپت باید از v2/tools/ اجرا شود.");
  process.exit(2);
}

// --- کپی پاک به پوشه موقت (بدون storage قبلی) ---
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-smoke-"));
fs.cpSync(SRC, path.join(WORK, "backend"), { recursive: true, force: true });
fs.rmSync(path.join(WORK, "backend", "storage"), { recursive: true, force: true });

const runtimeId = await loadNodeRuntime("8.3", { emscriptenOptions: { processId: 1 } });
const php = new PHP(runtimeId);
const handler = new PHPRequestHandler({
  documentRoot: "/backend/public",
  absoluteUrl: "http://127.0.0.1:8000",
  php,
  rewriteRules: [{ match: /^\/.*/, replacement: "/index.php" }],
  getFileNotFoundAction: () => ({ type: "404" }),
});
php.mkdirTree("/backend");
php.mount("/backend", createNodeFsMountHandler(path.join(WORK, "backend")));

let pass = 0, fail = 0;
function check(name, ok, extra = "") {
  if (ok) { pass++; console.log(`PASS ${name} ${extra}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

async function req({ method = "GET", url = "/api/health", body, token }) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  let bodyStr;
  if (body !== undefined) bodyStr = new TextEncoder().encode(JSON.stringify(body));
  const res = await handler.request({ method, url, headers, body: bodyStr });
  const raw = res && res.text !== undefined ? res.text : "";
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw: raw.slice(0, 300) }; }
  return { status: res ? res.httpStatusCode : -1, data, headers: res ? res.headers : null, raw };
}

// 1) health -> PHP + PDO + SQLite + migrate
{
  const r = await req({ url: "/api/health" });
  check("health ok=true", r.status === 200 && r.data.ok === true, `(${r.status})`);
}

let alice, bob;
{
  let r = await req({ method: "POST", url: "/api/register", body: { username: "alice__smoke", password: "secret123" } });
  check("register alice", r.status === 200 && !!r.data.token, `(${r.status})`);
  alice = r.data.token;
}
{
  let r = await req({ method: "POST", url: "/api/register", body: { username: "bob__smoke", password: "secret123" } });
  check("register bob", r.status === 200 && !!r.data.token, `(${r.status})`);
  bob = r.data.token;
}
{
  let r = await req({ method: "POST", url: "/api/register", body: { username: "alice__smoke", password: "x2secret" } });
  check("dup register 409", r.status === 409, `(${r.status})`);
}
{
  let r = await req({ method: "POST", url: "/api/login", body: { username: "alice__smoke", password: "wrong" } });
  check("bad login 401", r.status === 401, `(${r.status})`);
}

const dm = "dm:" + ["alice__smoke", "bob__smoke"].sort().join("|");
{
  let r = await req({ method: "POST", url: "/api/messages", token: alice, body: { roomId: dm, content: "salam aali" } });
  check("alice sends DM", r.status === 200 && r.data.message && r.data.message.content === "salam aali", `(${r.status})`);
}
{
  let r = await req({ url: "/api/history?room=" + encodeURIComponent(dm) + "&limit=20", token: bob });
  check("bob history has 1 msg", r.status === 200 && Array.isArray(r.data.messages) && r.data.messages.length === 1, `(${r.status})`);
}
{
  let r = await req({ url: "/api/my-rooms", token: bob });
  const room = (r.data.rooms || []).find(x => x.roomId === dm);
  check("bob unread=1", !!room && room.unread === 1, `(${r.status})`);
}
{
  let r = await req({ method: "POST", url: "/api/read", token: bob, body: { roomId: dm } });
  check("read ok", r.data.ok === true, `(${r.status})`);
  let r2 = await req({ url: "/api/my-rooms", token: bob });
  const room = (r2.data.rooms || []).find(x => x.roomId === dm);
  check("bob unread=0 after read", !!room && room.unread === 0, JSON.stringify(room));
}
{
  let out = await php.run({ code: `<?php require '/backend/app/Db.php'; $pdo=db();
    $st=$pdo->prepare("SELECT type, payload_json FROM events WHERE username=? ORDER BY id");
    $st->execute(['bob__smoke']);
    echo json_encode($st->fetchAll(PDO::FETCH_ASSOC));` });
  const outTxt = (out.stdout && out.stdout.text) || out.text || "";
  const evs = JSON.parse(outTxt || "[]");
  check("bob event queue", evs.some(e => e.type === "message"), JSON.stringify(evs.map(e => e.type)).slice(0, 120));
}
{
  let r = await req({ method: "POST", url: "/api/stream-ticket", token: bob });
  check("stream-ticket ok", !!r.data.ticket, `(${r.status})`);
}
{
  let r = await req({ url: "/api/users/search?q=bob", token: alice });
  check("search bob", r.status === 200 && Array.isArray(r.data.users), `(${r.status})`);
}
let firstMsgId;
{
  let r = await req({ url: "/api/history?room=" + encodeURIComponent(dm), token: alice });
  firstMsgId = r.data.messages[0].id;
  let r2 = await req({ method: "POST", url: "/api/reactions", token: alice, body: { roomId: dm, id: firstMsgId, emoji: "👍" } });
  check("reaction ok", r2.data.ok === true, `(${r2.status})`);
  let r3 = await req({ method: "POST", url: "/api/pin", token: alice, body: { roomId: dm, id: firstMsgId, pin: true } });
  check("pin ok", r3.data.ok === true, `(${r3.status})`);
  let r4 = await req({ url: "/api/my-rooms", token: alice });
  check("my-rooms alice", r4.status === 200, `(${r4.status})`);
}
{
  let r = await req({ method: "POST", url: "/api/messages/" + firstMsgId + "/edit", token: alice, body: { roomId: dm, content: "salam 2" } });
  check("edit ok", r.data.ok === true, `(${r.status})`);
  let r2 = await req({ method: "POST", url: "/api/messages/" + firstMsgId + "/edit", token: bob, body: { roomId: dm, content: "hack" } });
  check("bob cannot edit", r2.status === 403, `(${r2.status})`);
}
{
  let r = await req({ method: "POST", url: "/api/messages", body: { roomId: dm, content: "x" } });
  check("anon msg 401", r.status === 401, `(${r.status})`);
}
{
  let statuses = [];
  for (let i = 0; i < 22; i++) {
    let r = await req({ method: "POST", url: "/api/login", body: { username: "alice__smoke", password: "wrong" } });
    statuses.push(r.status);
  }
  const hit429 = statuses.filter(s => s === 429).length;
  check("login rate-limited", hit429 >= 1, `(${JSON.stringify(statuses)})`);
}

let gid;
{
  let r = await req({ method: "POST", url: "/api/groups", token: alice, body: { name: "تست گروه" } });
  check("group create", r.data.ok === true && !!r.data.group, `(${r.status})`);
  gid = r.data.group && r.data.group.id;
  let r2 = await req({ method: "POST", url: "/api/groups/" + gid + "/members", token: alice, body: { usernames: ["bob__smoke"] } });
  check("add member", r2.data.added === 1, `(${r2.status})`);
  let roomId = "group:" + gid;
  let r3 = await req({ method: "POST", url: "/api/messages", token: bob, body: { roomId, content: "سلام گروهی" } });
  check("bob posts in group", r3.data.message && r3.data.message.roomId === roomId, `(${r3.status})`);
  let r4 = await req({ url: "/api/history?room=" + encodeURIComponent(roomId), token: alice });
  check("group history", Array.isArray(r4.data.messages) && r4.data.messages.length === 1, `(${r4.status})`);
}
{
  let r = await req({ method: "POST", url: "/api/messages", token: alice, body: { roomId: dm, kind: "poll", poll: { question: "چای یا قهوه؟", options: ["چای", "قهوه"] } } });
  const pid = r.data.message && r.data.message.id;
  check("poll create", r.data.message && r.data.message.kind === "poll", `(${r.status})`);
  let rv = await req({ method: "POST", url: "/api/poll/vote", token: bob, body: { roomId: dm, id: pid, option: 0 } });
  check("poll vote", rv.data.ok === true, `(${rv.status})`);
  let rh = await req({ url: "/api/history?room=" + encodeURIComponent(dm), token: alice });
  const pollMsg = (rh.data.messages || []).find(m => m.id === pid);
  const votes = pollMsg && pollMsg.poll && pollMsg.poll.votes;
  check("poll vote recorded", !!(votes && (votes["0"] || []).includes("bob__smoke")), JSON.stringify(votes));
}
{
  let r = await req({ method: "POST", url: "/api/messages", token: alice, body: { roomId: dm, kind: "checklist", checklist: { title: "کارها", items: ["a", "b"] } } });
  const cid = r.data.message && r.data.message.id;
  check("checklist create", r.data.message && r.data.message.kind === "checklist", `(${r.status})`);
  if (cid) {
    let rt = await req({ method: "POST", url: "/api/checklist/toggle", token: bob, body: { roomId: dm, id: cid, index: 0 } });
    check("checklist toggle", rt.data.ok === true, `(${rt.status})`);
    let rt2 = await req({ method: "POST", url: "/api/checklist/toggle", token: bob, body: { roomId: dm, id: cid, index: 0 } });
    const m2 = rt2.data.message;
    check("checklist toggles back", m2 && m2.checklist && m2.checklist.items[0].done === false, JSON.stringify(m2 && m2.checklist));
  }
}

{
  let r = await req({ method: "POST", url: "/api/messages", token: alice, body: { roomId: dm, kind: "text", content: "فوروارد تست", fwdFrom: "bob__smoke" } });
  check("forward persists fwdFrom", r.data.message && r.data.message.fwdFrom === "bob__smoke", `(${r.status})`);
}

// باز کردن واقعی استریم: فرم `ready` باید همیشه با id 0 و maxEventId بیاید
// (کلید ضد «گرسنگی رویداد» بعد از ریست دیتابیس). ~۲۸ ثانیه طول می‌کشد.
{
  let r = await req({ method: "POST", url: "/api/stream-ticket", token: bob });
  const tic = r.data.ticket;
  let s = await req({ url: "/api/stream?ticket=" + tic + "&last_id=0", token: bob });
  const body = s.raw || "";
  check("stream ready frame", /id: 0\nevent: ready/.test(body) && body.includes('"maxEventId"'), `(${s.status})`);
  check("stream message event", body.includes("event: message"), "");
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);