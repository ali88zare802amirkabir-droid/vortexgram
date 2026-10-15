# Changelog

All notable UI work on the "Liquid Glass" redesign. Phases ship as small,
tested slices; each slice keeps the existing test suites green and adds
screenshot + DOM-metric evidence under `docs/screenshots/phase4/<slice>/`.

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
