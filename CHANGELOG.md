# Changelog

All notable UI work on the "Liquid Glass" redesign. Phases ship as small,
tested slices; each slice keeps the existing test suites green and adds
screenshot + DOM-metric evidence under `docs/screenshots/phase4/<slice>/`.

## Phase 5G — Live delivery hardening (instant display for the other party)

- **Root cause**: the server already pushed a message to the other party in
  ~1 ms (measured with two sockets). The visible delay came from *idle sockets
  being silently dropped* (Render/proxy idle timeout) followed by a 2.5 s
  reconnect with no catch-up — so a message sent during the gap only appeared
  after the socket came back.
- **Server heartbeat** — protocol-level `ping` every 30 s to every online
  socket; a socket that misses a full cycle is terminated so the client
  reconnects (and `close` still clears presence / stamps `lastSeen`). Also
  answers an app-level `{type:'ping'}` with `{type:'pong'}`.
- **Client keepalive** — the socket sends `{type:'ping'}` every 25 s and forces
  a clean reconnect if no traffic arrives for 60 s (half-open guard).
- **Faster reconnect** — exponential backoff starting at 500 ms (was a flat
  2.5 s), capped at 8 s, reset on a successful `ready`.
- **Resync on reconnect** — the moment a reconnect completes, the open
  conversation pulls incremental history (`after` the last known message) and
  the chat list refreshes, so nothing sent during the gap is lost.
- **Tests** — new `realtime` case in `tests/settings.test.js`: two live sockets,
  alice's message reaches bob promptly (<1.5 s) and the sender gets its own
  echo; plus ping→pong. Harness slice `5g` asserts the keepalive/resync wiring
  in a real browser (24/24).

## Phase 5F — Settings search, chat folders & help/about

- **Settings search** — a glass search field at the top of Settings. It filters
  both section titles and individual controls using a Persian + English synonym
  index (e.g. «زبان» and `language`, «آخرین بازدید» and `last seen`). Each hit
  deep-links into its section and scrolls to + briefly highlights the target
  control (respecting `prefers-reduced-motion`). Normalisation strips joiners
  and unifies Arabic/Persian letters and digits.
- **Chat folders section** — manage your own folders from Settings (create,
  edit, delete), reusing the same `openFolderManager()` as the folder bar so
  behaviour can't drift.
- **Help / About section** — real app version + build fetched from
  `/api/health`, live service status, an FAQ (`<details>`), links to the
  on-disk `privacy.html` / `terms.html`, and a shortcut into the AI assistant.
  Nothing here is faked.
- **`/api/health`** now returns `version` (from `package.json`) and `build`
  (git commit when the host provides one); covered by a new public-endpoint
  test.
- **Docs** — added `BACKLOG.md` listing everything the Telegram-parity spec
  asks for that is deliberately not wired yet, so nothing is hidden or faked.
- **Cache** — `app.js?v=189`, `shell.css?v=7`, service-worker `vortex-v202`.

## Phase 5C — Bubble shape, message grouping, composer morph

- **Radius wiring fix** — chat bubbles now read `--vx-r-bubble` /
  `--vx-r-bubble-tail`, so the appearance radius setting (sharp / compact /
  round / pill), added in 5A as a token, actually reshapes messages. Media
  bubbles keep their fixed frame.
- **Message grouping** — consecutive messages from one sender render as a
  single cluster: tighter spacing, one tail on the last bubble, avatar only on
  the last. Grouping is applied by a post-render pass, so it works for both a
  full history render and incremental appends, and day separators break groups.
- **Send ↔ mic morph** — the composer's round button settles to a muted mic
  look while the field is empty and springs to the accent send button once text
  exists, with `prefers-reduced-motion` respected.
- **Reaction feedback** — tapping an existing reaction pops it briefly.

Note: typing indicator, swipe-to-reply, the scroll-to-bottom pill and chat-row
swipe actions already existed from earlier slices and were left intact.

## Phase 5B — Resizable desktop panes + command palette

- **3-zone desktop layout** — the chat-list track is now driven by a single
  `--vx-list-w` variable. A drag handle (`role="separator"`, keyboard-operable
  with Arrow/Home/End, RTL-aware) resizes it between 240 and 560 px,
  persists the choice in `localStorage`, and double-click resets it. The
  conversation column keeps a floor so narrow desktops never overflow.
- **Command palette** — ⌘/Ctrl-K (and a header button) opens a glass overlay
  with a filtered, grouped, keyboard-navigable list: navigation, open
  conversation, theme switch, glass/aurora/saver toggles, and actions (new
  chat/group/channel, profile, log out). ARIA combobox/listbox wiring, focus
  restore, no inline handlers.

## Phase 5A — Design tokens, themes, self-hosted fonts

- **New `public/tokens.css`** — the single source of truth for the visual
  language: type scale, spacing/radius scales, motion tokens, elevation and
  named z-index, the glass recipe (blur / saturation / inner border / shine /
  noise), the animated aurora layer, an **AMOLED** theme, and seven extra
  accent presets (`indigo, teal, amber, rose, violet, sky, lime`) plus a
  derived `[data-accent="custom"]` block.
- **Accessibility fallbacks** — `.reduce-glass` / `[data-reduce-glass="on"]`
  and `@media (prefers-reduced-transparency: reduce)` collapse every glass
  surface to a solid translucent fill and zero the blur (Android WebView path).
  `:focus-visible` rings and a contrast scrim are defined here.
- **Self-hosted font** — added `public/font-face.css` + variable
  `public/fonts/Vazirmatn-var.woff2` (weights 100-900, Latin + Arabic). All
  Google Fonts references were removed from the app and the landing/legal
  pages; the CSP no longer allows `fonts.googleapis.com` / `fonts.gstatic.com`
  (`font-src 'self' data:`).
- **`public/design.js` rewritten** as the single writer for theme, accent,
  aurora, bubble radius, reduced-glass and auto day/night. It owns the shared
  `#vx-aurora` layer and emits a `vx-design` event; a serialisable
  `snapshot()`/`applySnapshot()` is provided for the upcoming 5E server sync.
- **Appearance settings page rewritten** (`renderAppSub`) with theme, accent,
  custom accent picker, auto night, aurora, bubble radius, glass quality,
  font size, font and corner-radius controls — all wired in JS (no inline
  handlers, strict CSP preserved).
- **Service worker** — `tokens.css`, `font-face.css` and the woff2 added to
  the precache SHELL; cache bumped.

## Phase 4C — Settings, profile, chat search

- Grouped settings list, restructured profile screen (hero, actions, back to
  settings), and an accessible chat search with a clear control, "no results"
  empty state and matched-contact section.

## Phase 4B — Chat list

- Folder strip (roving tabindex), swipe actions on chat rows, and contact
  sections.

## Phase 4A — App shell

- Design-token foundation, the glass / power-saving system, and the floating
  mobile navigation pill with a morphing active indicator plus a desktop rail.

## 2026-10-15 — Phase 5E (Telegram-grade Settings · server-side persistence)
- Server: users.settings JSONB (migration 0005_user_settings); GET/POST /api/profile/settings with whitelist, sparse merge, rate-limit (40/min), WS settings-updated.
- Active Sessions: /api/profile/devices includes id+current; revoke single and revoke-others; device IDs per login (sha1 UA/platform).
- Privacy (server): /api/users/exists/:username hides lastSeen for nobody/contacts (non-self), hides online when privacy.presence false.
- Client: VXSettings (debounced 400ms, optimistic, WS adopt); wired privacy, notifications, appearance (theme expanded to 10), chat, language, data; Active Sessions UI with revoke actions.
- Tests: tests/settings.test.js added; all 127/127 pass (+4 settings).
