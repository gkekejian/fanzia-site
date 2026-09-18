# Fanzia UI skill

Visual/UX direction for the Fanzia wholesale platform (`platform/`). Use this
whenever building or redesigning any user-facing surface: auth screens,
admin dashboard, buyer portal, application forms.

## Stack constraints (non-negotiable)

- Styling is hand-rolled CSS with design tokens in `platform/app/globals.css`.
  Do NOT introduce Tailwind, shadcn/ui, or any component library: that would
  rewrite the styling architecture for zero user benefit. Extend the token
  system instead of hardcoding values.
- Design tokens: `--fz-black: #0b0b0c`, `--fz-red: #f13737`,
  `--fz-border: #e2e2e5`, `--fz-bg: #fafafa`, `--fz-muted: #6b6b70`,
  `color-scheme: light`, system font stack. The red is the brand accent;
  use it sparingly (primary actions, key highlights), never as body text.
- No new paid dependencies. No new runtime dependencies without asking.

## Audience

Two owners run the whole business from their phones alongside full-time jobs.
Mobile-first is not a slogan here: design at 390px wide first, then scale up.
Every flow must be completable one-handed on an iPhone.

## Patterns to follow

Borrow the *composition* (not the tech stack) from these reference repos:

- Auth screens: centered card on a subtle background, brand mark on top,
  one clear headline, generous spacing, inline error states with
  `role="alert"`, visible loading state on the submit button, no dead ends.
  Ref: `arhamkhnz/next-shadcn-admin-dashboard` auth layouts (open-source-forks
  mirror: https://github.com/open-source-forks/next-shadcn-admin-dashboard).
- Admin shell: slim sidebar nav (collapsible on desktop, drawer on mobile),
  top bar with context, consistent page-header pattern (title left, primary
  action right). Never leave an admin page without navigation chrome.
  Ref: https://github.com/paceui/shadcn-nextjs-free-dashboard
- Data display: stat cards for counts, clean tables with row actions,
  status badges (`.badge`, `.badge-warn` already exist — extend the family,
  don't invent a parallel one).
  Ref: https://github.com/Kiranism/next-shadcn-dashboard-starter

## Rules

1. Visual/UX pass only unless told otherwise: never change auth logic,
   API routes, validation, or data flow in a UI task. Keep every
   `?error=` param, loading state, and empty state working.
2. Accessibility is part of "modern": real `<label>`s, focus-visible styles,
   sufficient contrast, `role="status"`/`role="alert"` where they exist.
3. One primary action per screen. If a screen has two equal buttons,
   the hierarchy is wrong.
4. Confirm destructive actions. Never use the words "reserved", "held",
   "secured", or "guaranteed" for inventory (business rule).
5. After any UI change: `npm test` (all green) and `npm run build`
   (clean) inside `platform/` before committing. Commit message starts
   with `UI:`.
