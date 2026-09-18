---
name: design-review
description: Use when a built interface needs a structured visual, interaction, responsive, accessibility, or theme critique against its design brief.
---

# Design Review

Review what was built against the brief and chosen aesthetic direction. Code
inspection alone is insufficient for visual claims.

## Process

1. Read `.design/<feature-slug>/DESIGN_BRIEF.md`. Ask which feature if several
   briefs exist.
2. Inspect every modified component, page, and style file. Check reuse,
   token usage, naming, and duplication.
3. Run the application and capture representative screenshots. Cover supported
   viewport sizes, dark mode, and meaningful interactive states such as focus,
   loading, empty, error, success, disabled, and open overlays. If browser
   automation is unavailable, request captures rather than pretending to have
   performed a visual review.
4. Analyze each screenshot for hierarchy, spacing, color, typography, overflow,
   layering, responsive reorganization, and visual defects.
5. Run the checklist below and cite exact files, lines, and screenshot names.
6. Prioritize findings as **Must fix**, **Should fix**, or **Could improve**.
7. Save `DESIGN_REVIEW.md` beside the brief, including a screenshot inventory.

## Checklist

- Visual hierarchy and reading order
- Consistent spacing, radii, borders, shadows, and semantic color
- Fidelity to the named aesthetic direction
- Reuse and quality of components
- Default, hover, focus, active, disabled, loading, empty, error, and success states
- Supported viewport behavior, no unwanted horizontal overflow, and 44×44px targets
- WCAG AA contrast, keyboard access, labels, semantics, focus, alt text, and reduced motion
- Typography, line length, loading behavior, and intentional type scale
- Dark-mode parity, token coverage, and non-inverted accents

## Output

```markdown
# Design Review: [Feature/Page Name]

Reviewed against: DESIGN_BRIEF.md
Philosophy: [named philosophy]
Date: [date]

## Screenshots Captured
| Screenshot | Viewport | Description |
| --- | --- | --- |
| `screenshots/review-page-desktop.png` | [size] | [what it shows] |

## Summary
[Overall quality and biggest finding.]

## Must Fix
1. **[Issue]**: [evidence and concrete fix].

## Should Fix
## Could Improve
## What Works Well
[Strong aspects to preserve.]
```

Adapted from `designer-skills` by Julian Oczkowski under the Apache License,
Version 2.0. Modified for general use; see `../NOTICE.md`.
