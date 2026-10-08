# AGENTS.md — VortexGram (D:\Projects\Vortex\messenger)

## Commands (from package.json — no README at repo root)
- `npm start` / `npm run dev` → `node server.js` (PORT env, default 3000).
- `npm test` → `node --test tests/db.test.js tests/forward.test.js tests/security.test.js` (uses embedded-postgres beta; may need Postgres on PATH-free embedded binary in node_modules).
- DB: `npm run db:migrate` (up), `npm run db:migrate:down`, `npm run db:status`, `npm run db:seed` (`migrate-pg.js`).
- Do NOT assume `npm run lint`/`npm run build` exist — there are none. For client moves, verify with `node --check public/*.js` and boot the server.

## Layout / entrypoints (real)
- Server entry: `server.js` (Express 4 + ws + Postgres via `pg`, multer uploads, optional Cloudflare R2 via @aws-sdk/client-s3). Runs the WS chat server on the same HTTP server.
- DB layer: `server/db/{connection.js,migrate.js,repositories.js}`; migrations in `server/db/migrations/000N_*/{up,down}.sql`.
- Client SPA: `public/index.html` → `public/app.js`, `public/icons.js`, `public/effects.js`, `public/theme.js`, `public/pwa.js`, `public/map-picker.js`, `public/photo-editor.js`, `public/video-actions.js`, `public/emoji-effect.js`.
- Service worker: `public/sw.js` (cache name `vortex-vNNN` — bump version query and `CACHE` after shipping client asset changes, or stale JS is served).
- Uploads dir: `public/uploads` (multer). Resized media/avatars stored via `durableUpload` (R2 if configured, else local).

## Things that will bite you (verified in this repo)
- `public/emoji-effects/`: `manifest.json` maps emoji → `/emoji-effects/tgs/U+XXXX/0.tgs` (124 files). Normalize emoji keys with the SAME `norm()` (strip U+FE0F/U+200D) as `emoji-effect.js` before lookup.
- **Do NOT append `?v=` to `*.tgs` requests.** Browser fetches of `/emoji-effects/tgs/*.tgs?anything` in this app context may come back `204`/`0 bytes` (curl still returns 200). Fetch the bare path with `{ cache: 'no-store' }` (already applied in `emoji-effect.js` `loadAnimationData`).
- **Use `Blob.stream()`, not `Response.stream()`,** for `DecompressionStream` input. `Response` has no `.stream()` — it throws `TypeError: (intermediate value).stream is not a function`. Correct TGS unpack: `new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()`.
- `.tgs` = gzip-wrapped Lottie JSON; parse with `JSON.parse` and hand `animationData` to `lottie.loadAnimation`. TGS files are real gzip (magic `0x1F 0x8B`), ~13–65 KB each, ~456 KB decompressed for 🔥.
- Emoji single-tap effect layer must stay `position:fixed; z-index:1600; pointer-events:none; background:transparent` inside `document.body` and must be `destroy()/remove()`ed on `complete|error|timeout`. Cap concurrency with `MAX_CONCURRENT=6` (variable already present).
- `/uploads/*` requires a logged-in user (401 without token) — it is an auth-gated proxy; do not expose it as public. CSP `connect-src 'self' blob: ws: wss:` — Blob/gzip streams are allowed, but extra CDNs are not.

## Media durability / env (.env.example)
- If `R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET` are set, media uploads go to Cloudflare R2; otherwise to local `public/uploads` (ephemeral on Render).
- For downloads to survive server restarts you MUST also set `R2_PUBLIC_BASE` (r2.dev public URL or CDN base). Without it, `/uploads` still streams from R2 but requires the server (auth-first).
- `/uploads` always tries `r2Proxy` first when R2 is enabled, then falls back to the local static dir.

## Verification habits that worked here
- Headless E2E without a DB fixture: register two users via `POST /api/register {username,password:'Test12345!',displayName}` and `PUT localStorage ft_token/ft_me/ft_me_ts` through `page.evaluateOnNewDocument`, then `openRoom('dm:...')`, push message, `renderMessagesBatch(...)`, dispatch `PointerEvent` on `.bubble`. (Scripts like this lived in `C:\Users\PC-ali\AppData\Local\Temp\opencode\dbg-*.js`.)
- To prove the emoji layer truly renders, poll `.emoji-fx-layer svg` count and check host `position:fixed`, `backgroundColor: rgba(0,0,0,0)`, and SVG is non-empty — a mere `RES 200` is not enough.
