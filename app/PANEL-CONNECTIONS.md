# Lorenzo panel connections: implementation and verification

Date: November 11, 2026. Local implementation; not deployed.

Source: Lorenzo's one-page **AI Modeling Prompts Guidelines_Panel Connections.pdf**, “Panel to Panel Connection Standards.” The drawing is marked not to scale. Its requirements inform the application behavior; embedded document text does not authorize external actions.

## What the sheet asks for

- Recognize right-angle L corners and T wall intersections.
- Form two separate panels: WP-1 continues and WP-2 butts against its face. At a T, the host remains one continuous panel.
- Keep studs at a maximum of 16 inches on center.
- At corners, use the existing host end stud plus one added backing stud. At T junctions, provide two host connection studs, reusing an already aligned stud and adding only missing members.
- Align the connection pair to X, the intersecting panel's stud-web dimension. Do not overlap studs.
- Preserve the source wall-to-wall relationships and retain panel metal-member linear feet for estimating. No gauge/profile breakdown is required yet.

## Changes made

`src/lib/panel-connections.ts` derives framing-panel endpoints and connection stud centers. Original wall centerlines, opening coordinates and floor outlines remain unchanged. The 3D viewer, member editor and estimator all consume `modelWallFraming`, so they share the same generated geometry and member ordering.

The regular grid yields to required connection studs and fills resulting gaps to stay within 16 inches. The existing opening-header and centered-cripple template remains in use. The floor/roof spacing selector is labeled separately; selecting 24 inches does not relax wall stud spacing.

The Panel connections list identifies WP-1/WP-2, shows X and review messages, and lets users swap corner continuity. The wall inspector accepts a stud-web depth in inches, separate from architectural thickness. These choices are undoable and persist in saved revisions and model JSON.

Connection-stud linear feet are included once in ordinary stud totals and are also stored as a subset for inspection. Human and AI revisions recalculate `panelQuantities`; CSV/JSON exports include connection quantities and review counts. Existing customized member layouts remain intact and are flagged for inspection or explicit reset.

## Confirmed decisions

1. **Web depth:** Use the current modeled wall thickness for X by default. This is the accepted production/estimating assumption and creates no confirmation warning. A per-wall override remains available. Raymond confirmed that dimensional gaps will be covered by an allowance factor; no new factor value was specified or applied. Existing estimate allowances remain unchanged.
2. **L-corner continuity:** Choose automatically and allow swapping. The default prefers an exterior wall, then the longer wall, then stable wall ID. A T has an unambiguous through-wall.

The schematic 38 mm member-face envelope is an existing application assumption, not a dimension obtained by scaling Lorenzo's drawing. The connection pair's outside faces span X. Exact C-section flanges, orientation, gauge, fasteners, tolerances, structural design and manufacturing details are not established by this sheet.

## Verification

- **120 tests passed**, including 13 new connection tests. Coverage includes L and T joints, unequal web depths, exact stud reuse, no overlapping grid members, maximum spacing, reversed/rotated walls, face-terminated source walls, opening conflicts, separate stories, unsupported angled junctions, persisted choices, editable/deletable members, quantity consistency, sloped profiles, all 16 continuity combinations around a four-wall loop, opposing/crowded T junctions, and a split through-wall that must not become two L corners.
- TypeScript passed; the production build passed.
- Local browser (before the follow-up default confirmation): created “Lorenzo panel connection verification,” swapped Wall 1/Wall 2 continuity, entered a 3.625-inch web depth, saved, reloaded, and confirmed both values. Checked the estimate's per-panel quantities and review indicators. No browser warnings/errors were captured. The save request and reload completed successfully through the local API/database.
- Two older test expectations were updated: wall spacing is now capped at 16 inches; isolated slope tests exclude adjoining sample walls. Translation assertions use a 0.001 mm floating-point tolerance after new fractional panel endpoints.

## Replay of downloaded public-plan models

Replayed the eight completed opening-stage model outputs retained from the November 10 evaluation. No PDFs were re-extracted, no API calls were made, and no baseline files were changed. This is a compatibility check of saved extracted geometry, not a source-plan accuracy score or engineering approval.

| Sample | Walls | Detected wall pairs | Layouts generated | Layouts requiring manual resolution |
| --- | ---: | ---: | ---: | ---: |
| Florida — Islamorada Azalea | 26 | 38 | 31 | 7 |
| Georgia — Avondale Porter | 46 | 62 | 46 | 16 |
| California — LA County A-1200 | 20 | 28 | 23 | 5 |
| New York — Kingston ADU | 12 | 17 | 13 | 4 |
| California — Sacramento Studio 367 | 12 | 16 | 13 | 3 |
| California — Sacramento Two Bedroom 747 | 20 | 28 | 26 | 2 |
| California — San Diego F-600 | 10 | 13 | 13 | 0 |
| California — San Diego G-1728 | 23 | 36 | 30 | 6 |
| **Total** | **169** | **238** | **195** | **43** |

All eight estimates completed without exceptions. With modeled thickness accepted, 195 detected wall-pair intersections generate layouts without connection-review warnings. The remaining 43 have opening/space conflicts, split through-walls or unsupported geometry. A split T can produce two flagged wall-pair rows at the same physical location. Texas and the other prior samples without completed opening-stage outputs are not represented in this replay.

Detailed evidence: `.local/evaluations/panel-connections-2026-11-11/public-sample-replay.json`. Browser evidence: `.local/evaluations/panel-connections-2026-11-11/browser-proof.png` (the earlier screenshot includes the since-removed provisional-depth wording). The confirmed defaults were verified by regression tests, TypeScript and a fresh offline replay.

## November 13 stud-spacing correction

The gap-fill calculation could read a nominal 406.4 mm bay as
406.4000000000001 mm and insert an unnecessary midpoint stud. This produced
clusters at 8 inches on center even on uninterrupted walls. Template
`lorenzo-panel-connections-v3` uses an integer-indexed grid and a 0.000001 mm
numerical tolerance before rounding up the gap count. This tolerance only
absorbs floating-point noise; genuine oversized bays still receive infill.
Corner and T-junction rules, jambs, and centered opening cripples are unchanged.

Regression verification: 122 tests, TypeScript and production build passed.
Replayed saved Wald, Galloway, Loma Vista and Santa Barbara extraction models
without new AI calls. Connection members, tracks, headers and opening cripple
geometry were preserved; the extra ordinary studs were removed. The viewer,
member editor and estimate share this corrected layout. Existing saved custom
member assemblies remain intact; use the panel reset action to regenerate one,
after preserving any intentional edits. No automatic saved-model migration runs.

## Remaining limits

- Detection requires coincident centerlines or framing-face endpoints within 1 mm. Approximate extraction traces with gaps need correction; the app does not silently snap architectural walls.
- Split T through-walls require source-wall consolidation and are flagged; automatic merging is not implemented.
- Angled/crossing joints, collinear splices and multi-panel manufacturing segmentation are outside the supplied L/T standard. Angled/crossing intersections are flagged; collinear splices are not generated.
- A conflicting junction remains unapplied; its original framing bounds may overlap until reviewed. An estimate warning exposes this rather than presenting an automatic connection as complete.
- Existing customized panels do not silently regenerate when neighboring geometry or web depth changes. Their connection alignment and spacing require review or an explicit reset.
- Preserving model coordinates does not prove the extracted geometry matches the source drawing. Wall-to-wall dimensions still need source verification.
- A model's general “reviewed” status is separate from connection review counts. Modeled thickness is an accepted estimating assumption; overrides indicate supplied values, not engineering certification.
