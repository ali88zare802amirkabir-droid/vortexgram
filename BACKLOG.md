# VortexGram — Backlog

This file is the **honesty ledger** for the "Liquid Glass 2.0 + Telegram-grade
Settings" work. Per the product brief, nothing is shown in the UI as a fake
toggle: if a setting cannot yet change real behaviour (client **and**, where it
matters, server), it is either not rendered at all or an explicit row points at
this document.

Shipped so far: 5A (tokens/themes/fonts), 5B (resizable panes + command
palette), 5C (bubbles/grouping/composer morph), 5E (server-backed settings +
active sessions), 5F (settings search, folders, help/about). See `CHANGELOG.md`.

Status legend: **[wip]** in progress · **[todo]** not started · **[blocked]**
needs infrastructure we don't have locally.

---

## Settings — feature parity with Telegram

### My Account
- [todo] Profile **QR code** (share your `@username` as a QR) — needs a QR
  renderer; no dependency added yet.
- [todo] **Emoji status** — needs a status field on the user model + WS
  broadcast.
- [todo] **Birthday** + privacy — needs a `users.birthday` column + a privacy
  rule.
- [wip] **Phone number** — city/phone fields exist partially; changing requires
  an OTP flow we do not have.
- [todo] **Call connect to your phone number** — out of scope (no telephony).

### Chat Folders
- [todo] **Include/exclude chat *types*** (Contacts, Non-contacts, Groups,
  Channels, Bots) — today folders hold an explicit chat list only
  (`includeFor`/`excludeFor` rule sets are not modelled).
- [todo] Folders **sync across devices** — currently stored in `localStorage`
  per account (`vxFolders:<user>`), not on the server.
- [todo] Folder **share link**.

### Notifications and Sounds
- [todo] Named **notification profiles** (Default / Silent / …) assignable
  per-chat.
- [todo] Per-chat **exceptions** (mute duration, custom sound).
- [todo] **Custom sound picker** + **vibration** pattern
  (`navigator.vibrate` is Capacitor-only on our targets).
- [todo] **Notification exceptions list** UI (the "Add exception" flow).
- Note: the on/off, sound, and message-preview toggles that *are* present are
  wired through `VXSettings` and enforced on the client; browser **permission**
  is the real gate on desktop.

### Privacy and Security (server-enforced where it matters)
- [done] `privacy.lastSeen` / `privacy.profilePhoto` / `privacy.presence`
  enforced server-side in `GET /api/users/exists/:username`.
- [todo] **Full per-item matrix** (Phone number, Bio, Birthday, Voice messages,
  Forwarded messages, Calls, Groups & Channels) — each needs its own server
  rule at the read point, not a client hide.
- [todo] **Block list** management UI (block/unblock) — block exists in places
  but there is no central "Blocked users" screen.
- [blocked] **Passcode / biometric app lock** — needs a device keystore
  (Capacitor Secure Storage / WebAuthn); not verifiable in this environment.
- [blocked] **Two-Step Verification (2FA)** — needs SMS/email OTP delivery.
- [blocked] **QR / link desktop login** — needs a device-linking handshake.
- [todo] **Auto-delete messages** (24h/7d/…) — server timer + storage.
- [todo] **Contacts sync** onboarding.
- [todo] **Data export** (JSON/HTML) + last-export timestamp.
- [wip] **Active Sessions** — list + per-device revoke + revoke-others **done**;
  session *auto-terminate* setting still [todo].
- [done] Terminate-all-other-sessions.

### Data and Storage
- [todo] Real **storage usage** breakdown (by media type) — needs a scan/summary
  endpoint.
- [todo] **Network usage** stats — needs byte accounting per category.
- [todo] **Keep media** duration, **max cache size**, per-network
  (Wi-Fi/mobile) auto-download rules.
- [done] Master auto-download toggles (photos/videos/save-data) persisted via
  `VXSettings`.
- [todo] **Storage cache clear** wired to real cache APIs (today it clears the
  service-worker cache only).

### Chat Settings / Appearance / Stickers
- [done] Theme (10 presets incl. AMOLED/Light), accent (12 + custom), aurora,
  bubble radius, glass quality, font family/scale, self-hosted Vazirmatn.
- [todo] **Chat background per-chat** (only a global background exists).
- [todo] **Dynamic color from wallpaper/avatar** (canvas dominant color).
- [todo] **Sticker / emoji pack** install & reorder UI (packs are static today).
- [todo] **Animated emoji** size/quality preference.

### Language / Accessibility
- [done] App language select + translate-button toggle.
- [todo] **Persian-digit** formatting option.
- [todo] **Text size**, **high contrast**, **reduce motion** as explicit
  Settings rows (they respect the OS setting but have no in-app switch yet).
- [todo] Language-pack completeness for `ar/tr/ru` (translation coverage).

### Devices / Premium / AI / More
- [wip] **Devices** — see Active Sessions.
- [todo] **Premium** — must reflect the *real* code limits only; not started
  because there is no entitlement system.
- [done] **AI assistant** entry point (existing `/api/ai` layer, explicit
  action only — never reads private content automatically).
- [done] **Help / About** (version, status, FAQ, policy links).
- [done] **Log out**.

---

## Design system — remaining brief items

- [todo] **True list virtualisation** for chat list + long histories (today a
  `MSG_RENDER_LIMIT = 100` window plus incremental append).
- [todo] Living **aurora / mesh** movement tied to time-of-day and paused on low
  battery (there is a static aurora + power-saver fallback).
- [todo] **Spring/haptics** parity via Capacitor Haptics on native builds.
- [todo] **Story rings / presence dot / animated badges / verified badges**
  polish pass.
- [todo] Link-preview cards, voice-waveform scrubbing, media-viewer
  swipe-dismiss, round video notes.
- [todo] **Unified search** across chats/messages/contacts with filters.
- [todo] **Focus mode**, per-chat **"vibe"**, scheduled send UI, quick-reaction
  bar, message effects on send.

## Engineering
- [todo] Split `public/app.js` into modules (ES modules or a light bundler) —
  still a monolith.
- [todo] `tests/db.test.js` needs a Postgres fixture; it currently fails without
  a local embedded Postgres (`npm test` includes it).
- [todo] Per-chat / rule-based folder model (see Chat Folders).
