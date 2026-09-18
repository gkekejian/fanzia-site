---
name: design-tokens
description: Use when a project needs a visual system, a missing token category, or a theme extension before components are built.
---

# Design Tokens

Create or extend a semantic visual system. Components should consume tokens
instead of embedding repeated visual decisions.

## Process

1. Inspect existing CSS variables, theme providers, token JSON, configuration,
   and UI dependencies. Extend existing tokens; never replace them blindly.
2. Read the feature's design brief and derive values from its chosen
   philosophy.
3. Use the format the stack expects. Prefer CSS custom properties when no
   format is established.
4. Provide intentional light and dark palettes when the product supports
   themes.
5. State the design philosophy, deviations, and verification performed.

## Token categories

Use semantic names rather than raw values in components:

```css
--color-bg-primary; --color-bg-secondary; --color-bg-inverse;
--color-text-primary; --color-text-secondary; --color-text-link;
--color-border-primary; --color-border-focus;
--color-accent-primary; --color-accent-primary-hover;
--color-status-success; --color-status-warning; --color-status-error;
--space-0; --space-1; --space-2; --space-4; --space-8;
--font-family-body; --font-family-mono;
--font-size-sm; --font-size-md; --font-size-lg;
--line-height-tight; --line-height-normal;
--border-radius-sm; --border-radius-md;
--shadow-sm; --shadow-md;
--duration-fast; --duration-normal;
--easing-default;
```

Derive the scale from the values already used. A tight, balanced, or spacious
base should follow the chosen philosophy rather than forcing a new rhythm.

## Theme checks

- Do not simply invert the dark palette.
- Keep text and accents accessible on every surface.
- Adjust shadows and accent lightness per theme.
- Use the project's established theme mechanism; do not introduce a competing
  preference query or theme attribute.
- Verify both themes and include reduced-motion behavior where motion exists.

Adapted from `designer-skills` by Julian Oczkowski under the Apache License,
Version 2.0. Modified for general use; see `../NOTICE.md`.
