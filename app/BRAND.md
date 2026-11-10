# Fraaime application brand reference

Source: **Fraaime Guideline.pdf**, version 1.0, designed by Arusik Ghazaryan, supplied by Raymond on November 9, 2026. The original PDF remains private and is not included in this repository.

## Identity and palette

The SVG symbol and combination mark in `public/brand` preserve the original outlined artwork from page 8. Do not redraw, stretch, rotate, outline, or recolor them. Use the black artwork on a light background. The studio shows the combination mark on desktop and the standalone symbol on small screens; both have a 70 px displayed height, following page 10. The favicon uses the dedicated small-symbol application described on page 7. Keep other content outside the mark's immediate space; partner lockups require the full symbol-sized exclusion zone from page 9.

| Role | Hex |
| --- | --- |
| White | #FFFFFF |
| Yellow accent | #FFF895 |
| Light gray | #EDEDED |
| Gray | #C8C8C8 |
| Gray | #ACACAC |
| Gray | #79787D |
| Warm gray | #544F4C |
| Brown green | #4B412B |
| Black | #000000 |

These values are centralized in `src/app/globals.css`. Yellow highlights actions and selection; use black text on yellow. Small secondary text uses warm gray for readability. Error red is a functional accessibility exception, not a new brand accent. The 3D model uses the same neutral palette and yellow selection; the transform gizmo retains its conventional axis colors. Geometry remains identifiable through labels and the inspector.

## Typography

The guide specifies **PP Neue Montreal** throughout, with **-0.02em headline letter spacing**. Raymond approved a temporary font fallback on November 9: Helvetica Neue, Helvetica, Arial, sans-serif. Licensed webfont files are still needed from Lorenzo. Do not extract a subset font from the PDF or download an unlicensed substitute.

When licensed WOFF2 files are supplied, add `@font-face` declarations for PP Neue Montreal and the supplied weights with `font-display: swap`; the shared CSS and Clerk font stacks already select that name first. Do not publish font binaries in the public repository unless their license permits it.

Marketing headline reference sizes: 89, 80, 48, 38, 26, 18 px, with the line-height ratios from pages 17–18. The studio uses responsive headings up to 89 px, 38 px project titles, 26 px section titles, 18 px subheadings and introductory copy. Dense editor controls, tables, and explanatory labels use smaller sizes for application usability; this is a deliberate product adaptation of the marketing hierarchy.

## Language

Positioning: **AI-powered structural framing**. Use direct, clear, confident language about plans, framing, precision, and review. Distinguish current pilot behavior from future services. Do not repeat performance percentages from example marketing artwork as verified product results. AI drafts and illustrative framing require human review; model review is not engineering approval.

The estimate is preliminary and uses explicitly fictional, editable sample prices. Do not present it as supplier pricing or a construction quote. See `ESTIMATING.md` for scope and calculations.

## Review checklist

Check the dashboard, sign-in, model editor, source sheets, review states, estimate, and mobile layout. Preserve keyboard focus, readable text contrast, accessible control labels, and horizontal scrolling within wide tables. Customer PDF sheets and models must remain outside the public source repository.
