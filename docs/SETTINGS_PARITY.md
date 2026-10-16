# VORTEXGRAM — Settings Parity Gap Analysis (Task T · Step 0)

Date: 2026-10-15 · Branch: `feat/settings-parity` · Author: engineering

This document is the **honesty ledger** for Task T ("Telegram-class settings
parity"). For every option in the brief it records the real state today. An
option only counts as **DONE** when it is (a) stored server-side per user with
whitelist validation, (b) synced across devices, (c) has a real effect, (d) is
enforced on the server when it concerns other users' data, and (e) is covered by
a test. Everything else is labelled honestly.

Nothing here copies any third-party brand, logo, icon, string, art or source
code. We replicate *functional capability and familiar UX structure* only, with
VORTEX's own icons, Persian copy and glass visual language.

## Legend

| Tag | Meaning |
| --- | --- |
| **DONE** | Stored + synced + real effect + server-enforced where relevant + tested |
| **STORED** | Persisted server-side (sparse JSON, whitelisted) and synced, but the effect is not wired yet |
| **UI-ONLY** | Rendered in the client and/or persisted, but has **no real effect** → must be fixed first |
| **LOCAL** | Only in `localStorage` (per device, not synced) |
| **MISSING** | Not present at all |
| **OOS** | Out of scope per the brief (payments, premium, stars, wallet, calls) or impossible in this stack (see "Not implemented, and why") |

## Current architecture snapshot

- **Server spec** (`server.js`): `SETTINGS_DEFAULTS`, `SETTINGS_ENUMS`,
  `SETTINGS_BOOLS`, `getPath`/`setPath`, `deepMergeSettings`, `settingsView`,
  `sanitizeSettingsPatch`, `settingsRateOk` (40 writes/min/user).
  - Endpoints: `GET/POST /api/profile/settings`, `GET /api/profile/devices`,
    `POST /api/profile/devices/revoke`, `.../revoke-others`.
  - Persistence: `users.settings` JSONB (migration `0005_user_settings`), sparse,
    plus JSON-file fallback parity.
  - Sync: WS `settings-updated` → client `VXSettings.adopt`.
  - Server enforcement today: a single `canSee(viewer, owner, key)` helper
    (`server.js`, right after `canAccess`) applies the privacy tiers
    (`everybody`/`contacts`/`nobody`) at **every** exposure point:
    `GET /api/user/:username` (photo/bio/phone), `GET /api/users/search`
    (photo + presence), `GET /api/users/exists/:username` (lastSeen + presence),
    `enrichMsg`/`enrichMsgBatch` (`fromAvatar`), and the WS `ready` read-state
    snapshot (`filterReadStateFor`). `room-read` is not broadcast when the
    reader has `privacy.readReceipts=false`.
  - **Contacts graph (interim)**: `relatesTo(a,b)` = either user lists the other
    in `user.contacts`, **or** they share a DM room (`db.messages['dm:a|b']`).
    This already makes the `contacts` tier trustworthy without a client-trusted
    list; a first-class `user_contacts` model + management UI is still Slice D.
  - Unset keys fall back to the documented default (so `phone` stays hidden for
    accounts that never touched settings).
- **Client**: `VXSettings` (defaults mirror + debounced POST), `SETCATS` (12
  sections: account, appearance, background, skins, notifications, chat,
  privacy, language, storage, folders, help, logout) with fa/en settings search.
- **Contacts graph**: none on the server. "Contacts" live only in client
  `localStorage` (`getContacts`/`saveContacts`, `app.js:1361`). This blocks a
  trustworthy `contacts` privacy tier and is the first structural gap.
- **Blocked users**: `user.blocked` array exists and is enforced in
  `canAccess`/DM send; no central "Blocked users" management screen.

## Existing server settings keys (today)

```
privacy:       lastSeen(E), profilePhoto(E), bio(E), phone(E, default nobody), readReceipts(E), presence(E)
notifications: enabled, sound, preview            (client effects exist)
data:          autoDownloadPhotos(UI-ONLY), autoDownloadVideos(UI-ONLY), saveData(DONE — power-saver)
appearance:    theme, accent, bubbleRadius, reduceGlass, aurora   (real effects)
language:      code, translateEnabled(E — gates the translate action)
chat:          showTyping(E — gates outgoing typing), enterToSend(E — gates Enter)
```
(E = enforced / real effect.)

## Progress log

- **2026-10-16 · Task T batch 1 (privacy enforcement + UI-ONLY 1–3,5–7):**
  added `canSee`/`relatesTo`/`dmRoomBetween`/`hasContact`/`readReceiptsEnabled`/
  `filterReadStateFor`; wired them through every profile/message exposure point;
  added `privacy.bio` + `privacy.phone` tiers (client selects + search entries);
  gated outgoing typing, Enter-to-send and the translate action on their stored
  keys. Tests: settings 8/8 (incl. new tier + read-receipt tests). Remaining
  UI-ONLY: `data.autoDownloadPhotos/Videos` (deferred to Slice E — full matrix).

---

## 1. My profile

| Option | Status | Notes / evidence |
| --- | --- | --- |
| Profile photo (set/remove) | DONE | `/api/profile/avatar`; `me` broadcast |
| Photo **crop** | DONE | `photo-editor.js` |
| **Multiple photos + history** | MISSING | single `avatar` field only |
| Name / display name | DONE | `/api/profile` + `nameChanged` rules |
| Bio | DONE | `publicUser.bio` |
| Username + **public link** | MISSING | users log in by username; no `vortexgram…` share link/QR |
| Birthday + who can see | MISSING | no field |
| Phone + who can see | STORED/UI-ONLY | `phone` stored; shown unconditionally; no privacy tier |
| Status / emoji status | MISSING | no field |
| Profile color / cover | MISSING | only `profileBg`/`profileEffect` skins in `publicUser` |
| Profile **posts** (photos/videos, public/archived) | MISSING | — |
| Personal channel link | MISSING | — |
| Business profile (hours, location, quick replies, greeting/away) | MISSING | — |
| Saved messages (own chat, folders/tags, search) | MISSING | no self-room |

## 2. Saved messages

| Option | Status | Notes |
| --- | --- | --- |
| Own saved-messages chat | MISSING | — |
| Folders/tags within saved | MISSING | — |
| Search inside saved | MISSING | global search exists for chats only |

## 3. Chat settings (appearance)

| Option | Status | Notes |
| --- | --- | --- |
| Theme light/dark/AMOLED | DONE | `appearance.theme` (10 presets) |
| Theme **auto / scheduled (day/night)** | STORED (auto-night exists in design.js) | scheduling MISSING |
| Accent | DONE | 12 presets + custom |
| **Custom themes save/export/import JSON** | MISSING | only accent + presets |
| Wallpapers (gallery/color/gradient/pattern/blur/dim) | MISSING | `background` section is minimal |
| **Per-chat wallpaper** | MISSING | — |
| Text size | DONE | font-scale control |
| Bubble corner radius | DONE | `appearance.bubbleRadius` |
| Chat list density | MISSING | — |
| Message grouping style | DONE | 5C grouping (style option MISSING) |
| Emoji style / size | MISSING | — |
| Link previews on/off | MISSING | link-preview endpoint exists, no toggle |
| In-app browser | MISSING | — |
| Send with Enter vs Ctrl+Enter | DONE | `chat.enterToSend` gates the composer keydown |
| Raise-to-speak off | MISSING | — |
| Autoplay GIFs/videos | MISSING | — |
| Large emoji | MISSING | emoji-effect layer exists (not a size option) |
| Animated emoji effects on/off | STORED | uses aurora/reduceGlass partly; needs own key |
| Swipe actions customization | MISSING | swipe-to-reply exists, not configurable |
| Quick reaction choice | MISSING | — |
| App icon / theme color | MISSING | — |

## 4. Notifications

| Option | Status | Notes |
| --- | --- | --- |
| Master on/off, sound, preview | DONE (client effects) | `notifications.*` |
| Per-type profiles (private/groups/channels/reactions) | MISSING | — |
| Own sound set | MISSING | single beep |
| Vibration / LED color | MISSING | — |
| Priority | MISSING | — |
| In-app sounds/vibrate/preview | STORED | `notifications.*` single profile |
| "Contact joined" | MISSING | — |
| "Pinned messages" alerts | MISSING | — |
| Badge counter rules (count muted? chats vs messages) | MISSING | — |
| Repeat reminders | MISSING | — |
| DND schedule | MISSING | — |
| Per-chat exceptions (mute 1h/8h/2d/forever, sound, hide preview) | MISSING | mute exists per-room in chat state only |
| Browser push permission + test button | DONE (permission) | test button MISSING |
| Web Push / Capacitor push | OOS/blocked | no push subscription backend; Capacitor not runnable here |

## 5. Privacy & security

| Option | Status | Notes |
| --- | --- | --- |
| lastSeen & online tier | DONE (server-enforced) | `exists` endpoint via `canSee` |
| lastSeen "My contacts" tier | DONE | `relatesTo` = shared DM room or `user.contacts` |
| Profile photos tier | DONE | `canSee` at `/api/user/:username`, search, `fromAvatar` |
| Bio / Phone tiers | DONE | `privacy.bio` (default everybody), `privacy.phone` (default nobody); enforced server-side. Birthday still MISSING. |
| Forwarded-messages link | MISSING | — |
| Who can message me | MISSING | — |
| Who can add me to groups/channels | MISSING | — |
| Voice messages permission | MISSING | — |
| Read receipts | DONE (server-enforced) | `room-read` suppressed when reader opts out; `ready` filters others' receipts |
| Typing indicator (send) | DONE | `sendTyping` honours `chat.showTyping` |
| Always/Never share-with lists | MISSING | — |
| Blocked users screen | PARTIAL | block enforced; no management UI |
| App passcode lock + auto-lock + fingerprint/WebAuthn | MISSING | needs keystore/WebAuthn |
| Hide in app switcher | OOS | native only |
| Two-step password (hint, recovery email) | MISSING | — |
| Active sessions (terminate one/all, auto-terminate inactive N days) | DONE (terminate) / MISSING (auto) | revoke endpoints exist |
| QR desktop link | OOS | needs secure device-linking handshake |
| Login alerts | MISSING | — |
| Passkeys (WebAuthn) | MISSING | — |
| Auto-delete default + per-chat | MISSING | — |
| Delete account if away for N | MISSING | — |
| Archive & mute new chats from non-contacts | MISSING | — |
| Restrict messages from unknown users | MISSING | — |
| Sensitive-content filter | MISSING | — |
| Clear AI data cache | MISSING | — |
| Data export / download my data | MISSING | — |

## 6. Data & storage

| Option | Status | Notes |
| --- | --- | --- |
| Storage usage per chat/type + clear per category | MISSING | only a global "clear cache" (SW cache) |
| Keep media duration | MISSING | — |
| Auto-download matrix (network × type × size) | UI-ONLY (3 master toggles) | `data.autoDownload*` unused in rendering |
| Save-to-gallery | MISSING | — |
| Streaming | MISSING | — |
| Data-saver mode | DONE | `data.saveData` drives power-saver (`design.js`) |
| Network usage stats | MISSING | — |
| Proxy settings | OOS | not supported |
| Clear drafts | MISSING | drafts exist in composer |
| Link-preview privacy | MISSING | — |

## 7. Chat folders

| Option | Status | Notes |
| --- | --- | --- |
| Custom folders (create/edit/delete) | DONE | `openFolderManager`, Settings section (5F) |
| Include/exclude **by type** + read/muted/archived filters | MISSING | explicit chat list only |
| Icons / order / tabs vs sidebar | MISSING | — |
| Unread counters | DONE | folder bar |
| Share folder link | MISSING | — |

## 8. Devices

| Option | Status | Notes |
| --- | --- | --- |
| List sessions (device/browser/city/last active) | PARTIAL | device/browser/last-active exist; approximate city MISSING |
| Terminate one / all others | DONE | `devices/revoke`, `revoke-others` |
| Auto-terminate inactive N days | MISSING | — |
| QR link new device | OOS | secure handshake needed |

## 9. Power saving

| Option | Status | Notes |
| --- | --- | --- |
| Off / auto / always + thresholds | PARTIAL | glass/saver modes exist; not user-thresholded |
| Toggle blur/glass, animations, emoji effects, autoplay, background sync | PARTIAL | `reduceGlass`/`saveData` only |
| Low-end auto-detection | DONE | `design.js` reasons |

## 10. Language

| Option | Status | Notes |
| --- | --- | --- |
| fa/en dictionary (i18n, no hardcoded strings) | MISSING | UI strings are hardcoded Persian |
| Digits style (Persian/Latin) | MISSING | — |
| Jalali/Gregorian | PARTIAL | Jalali used in separators, not configurable |
| 12/24h clock | MISSING | — |
| RTL/LTR auto per chat | DONE | global RTL + `dir="ltr"` where needed |
| Translate button enabled | DONE | `language.translateEnabled` gates the message action |

## 11. Help

| Option | Status | Notes |
| --- | --- | --- |
| FAQ | DONE | 5F help section |
| Report a problem (attach safe logs) | MISSING | report exists for messages/users only |
| Privacy policy / Terms | DONE | `privacy.html` / `terms.html` |
| Version | DONE | `/api/health` version+build |
| Changelog | MISSING | `CHANGELOG.md` exists, not surfaced in app |

## 12. Cross-cutting

| Option | Status | Notes |
| --- | --- | --- |
| Settings search (jump to row) | DONE | 5F, fa/en synonyms, deep-link + highlight |
| Per-setting "reset" | MISSING | — |
| "Reset all" | MISSING | — |
| Backup / restore JSON | MISSING | — |
| Per-chat overrides | MISSING | — |
| Live preview components (bubble, notification) | MISSING | — |
| Keyboard shortcuts page | MISSING | — |
| Accessibility: font scale | DONE | — |
| Accessibility: reduce motion / high contrast | PARTIAL | OS-driven; no in-app switch |

---

## UI-ONLY items to fix first (highest priority)

These are rendered/stored today but do nothing — the exact thing the brief
forbids:

1. ~~`privacy.profilePhoto`~~ — **FIXED** (Task T batch 1): enforced at every
   avatar exposure point via `canSee`.
2. ~~`privacy.readReceipts`~~ — **FIXED**: `room-read` is suppressed when the
   reader opts out; the `ready` snapshot filters other readers' receipts.
3. ~~`privacy.lastSeen = contacts`~~ — **FIXED**: `relatesTo` resolves contacts
   from a shared DM room or `user.contacts` (no client trust).
4. `data.autoDownloadPhotos` / `data.autoDownloadVideos` — **still ignored by
   rendering** (deferred to Slice E for the full network × type × size matrix).
5. ~~`language.translateEnabled`~~ — **FIXED**: the translate action is only
   offered when the key is on.
6. ~~`chat.showTyping`~~ — **FIXED**: `sendTyping` never broadcasts when off.
7. ~~`chat.enterToSend`~~ — **FIXED**: composer keydown honours the key
   (off → Ctrl/⌘+Enter sends).

Fix approach used: **one** `canSee(viewer, owner, key)` helper on the server
(fed by a server-side relationship graph) routed through *every* API/WS exposure
of gated data; client effects wired for 2,5,6,7.

## Not implemented, and why

- **Payments / premium / stars / wallet / calls** — OOS per the brief.
- **Web Push / Capacitor push, vibration, LED, hide-in-app-switcher, biometrics**
  — require a native runtime / push service; not runnable or testable in this
  environment. Listed, never faked.
- **QR desktop login / passkeys** — need a secure device-linking handshake and
  WebAuthn server support; risk of a fake/insecure implementation is too high.
- **Proxy settings** — the platform exposes no proxy control.
- **Per-chat wallpaper / multiple profile photos / posts / business profile /
  personal channel** — buildable in this stack; scheduled for slices A–E, not
  skipped.
- **contacts graph** — will be added server-side (`user_contacts`) in Slice D,
  since the `contacts` privacy tier is otherwise untrustworthy.

## Slice plan (each slice ends with tests + screenshots + doc update)

- **A — Profile**: server fields (birthday, phone tier, emoji status, cover,
  bio), multiple photos + history, profile posts, business block, public link.
- **B — Appearance**: theme scheduling, custom theme JSON import/export,
  wallpapers + per-chat, density, grouping style, emoji size, link-preview
  toggle, send-key, swipe/quick-react config, autoplay, large emoji.
- **C — Notifications**: per-type profiles, sound set, vibration, DND, badge
  rules, per-chat exceptions, test notification.
- **D — Privacy/security**: `canSee()` + `user_contacts`, full tier matrix,
  always/never lists, block screen, read-receipt + typing enforcement, app
  passcode (WebAuthn where supported), 2FA, sessions auto-terminate, login
  alerts, auto-delete, delete-account timer, filters, AI cache clear, export.
- **E — Data/storage + folders**: usage breakdown + clear per category,
  keep-media, auto-download matrix, folder type filters/icons/order.
- **F — Devices/power/language/help**: session city, auto-terminate, power
  thresholds + sub-toggles, i18n dictionary + digit/calendar/clock options,
  help/report/changelog.
- **G — Cross-cutting**: reset per-setting + reset all, backup/restore JSON,
  live previews, shortcuts page, a11y switches.

## Verification protocol (every slice)

1. `node --check` on each changed JS file; encoding check (no U+FFFD/mojibake).
2. Full test suite on **Postgres** and **JSON** backends; every new option gets
   a test proving its **effect** (not just 200 OK).
3. Boot with **no optional env vars**.
4. Headless screenshots 390x844 + 1440x900, dark/light, glass on / power-saving
   on → `docs/screenshots/settings/<slice>/`.
5. Update this file (statuses) + `CHANGELOG.md`.
