# Preliminary framing estimates

The Estimate tab calculates indicative quantities from the current editable model, across all floors. It makes no AI calls and does not add AI processing charges. Default prices are **fictional demonstration values in USD**, not researched market rates or supplier quotes.

## Quantity and cost rules

- Uncustomized walls use the same stud, track, and opening-header generation as the 3D framing view, at 16 or 24 inches on center. Once a wall is customized, only its saved individual members are counted; deleted members remain excluded.
- Saved stud length is its height; track, header, and joist length is their length field. Moving a member leaves quantity unchanged; resizing or deleting it updates the estimate. Generic boxes are flagged and unpriced.
- Automatic floor framing is optional (off by default). Automatic roof framing is optional (on by default); roof decks are excluded. Voids reduce floor/roof areas and clip framing. Sloped roof lengths and surface areas use 3D geometry.
- All generated members are indicative. No gauge/grade selection, connection design, load validation, stock-length optimization, or fabrication-ready bill of materials is provided.
- Quantities are rounded to two decimals. Material billable linear feet include the configured waste allowance. Labor is an optional area allowance using gross framed wall area and included net floor/roof areas; stand-alone manual members do not add a separate labor area.
- Direct cost = materials + labor + delivery. Contingency applies to direct cost. Markup applies to direct cost plus contingency; it is not a profit-margin calculation. Money is rounded to cents at each line/total stage. An empty scope costs zero, including no delivery.

Defaults: studs $2.40/LF, tracks $1.65/LF, headers $5.50/LF, joists $4.20/LF; wall labor $1.25/SF, floor labor $1.50/SF, roof labor $2.00/SF; material waste 10%, delivery $450, contingency 10%, markup 15%. Edit these in the Estimate tab.

## Saving and exports

Settings are optional versioned metadata on the model. A human Save revision freezes the current defaults or custom prices into that revision. Undo/redo works for settings; reopening a saved revision restores them. The estimate recalculates from that revision's geometry. AI extraction does not supply pricing and new AI candidates do not overwrite the human revision.

CSV and JSON exports identify mock pricing, model revision, unsaved status, scope, quantities, rates, totals, exclusions, and member-to-element references. CSV text is escaped against spreadsheet formula injection. JSON includes generation time and the full estimate snapshot. Exports reflect current edits, so save first when sharing a durable revision.

## Limits

Tax, engineering, permits, foundations, sheathing, fasteners, connectors, bracing, roof coverings, installed doors/windows, finishes and MEP are excluded. Unresolved review issues and unconfirmed scales are surfaced. Quantity generation stops at 50,000 members with an explanatory error rather than presenting a partial total. A reviewed visualization does not make these prices or quantities construction-ready.

Future estimating work should add supplier-maintained price catalogs, gauge/grade and stock lengths, engineered assembly specifications, location-specific labor, tax/freight rules, estimator approval, and auditable customer quotations.
