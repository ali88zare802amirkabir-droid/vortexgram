# Mobile Bottom Navigation Bar — QA Checklist

## Automated checks
- `node --check public/app.js` passes
- `node --check server.js` passes
- `npm test` passes (24/24)

## Manual viewport checks (360×640, 390×844, 412×915)

### Top-level screens (bar visible)
- [ ] Chat list: last chat row fully visible above bar; tap opens chat
- [ ] Contacts: last contact row fully visible; tap opens DM
- [ ] Settings home: last category row fully visible; tap opens sub-page

### Hidden on non-top-level screens
- [ ] Open chat: bar hidden; composer not covered; send button tappable
- [ ] Settings sub-page: bar hidden; back button tappable; last row not covered
- [ ] Profile edit: bar hidden; save button tappable
- [ ] Search overlay: bar hidden; input focusable
- [ ] Media viewer: bar hidden; close button tappable
- [ ] Any modal/sheet: bar hidden

### Keyboard
- [ ] Open chat, focus composer → bar hides; input visible; send tappable
- [ ] Dismiss keyboard → bar reappears

### Active tab
- [ ] Active tab icon/label visibly different (color + weight)
- [ ] Per-screen state preserved (selected tab stays highlighted)

### Floating buttons
- [ ] Scroll-to-bottom FAB sits above bar (not behind)
- [ ] Toast appears above bar

### Safe area
- [ ] On notched devices (iPhone), bar respects safe-area-inset-bottom
- [ ] No content hidden behind safe area
