# Evaluate plan extraction before production

Candidate: `gpt-6.1-sol`, `reasoning.effort=medium`, standard processing.
Verified on 2026-11-09 against [Sol's model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [migration guidance](https://developers.openai.com/api/docs/guides/latest-model).
Input is $2 and output is $10 per million tokens. Output includes reasoning tokens.
The application charges its budget conservatively at uncached rates and applies the documented long-context surcharge above 272,000 input tokens. Invoice totals may be lower due to cache discounts. No cache-write duration is requested.

The candidate allows 24,000 total output tokens (reasoning and JSON combined), compared with the 16,000-token GPT-4.1 baseline, and a 240-second API timeout inside the 300-second workflow step. Incomplete results remain failures; no silent API retry is enabled. The current pipeline uses version 2 PDF evidence and nullable observations. Do not compare its results directly with an older run as though only the model changed.

## Private comparison

Customer PDFs, manifest paths, annotations, crops, responses and reports belong under ignored `.local/evaluations/` or another private directory. Never add them to Git. This runner does not connect to Neon, Blob or production workflows.

Create a private manifest with `cases`, each containing:

```json
{
  "cases": [
    {
      "id": "synthetic-example-1",
      "pdf": "/private/path/to/source.pdf",
      "page": 1,
      "expectedKind": ["schedule"],
      "facts": [
        {
          "kind": "window",
          "tag": "W1",
          "width": 914.4,
          "height": 1219.2,
          "count": 2
        }
      ]
    }
  ]
}
```

Pages are one-based. Dimensions are millimeters; annotate facts from source sheets independently of model outputs. `count` is optional; use it for repeated schedule type marks. A 3 mm comparison tolerance only accommodates numeric conversion, not construction tolerances. The manifest also needs floor plans with independently reviewed geometry before a production decision.

```sh
worker/.venv/bin/python scripts/prepare-evaluation.py .local/evaluations/run/manifest.json
npm run evaluate:models -- .local/evaluations/run/prepared.json .local/evaluations/run/dry-run
# OPENAI_API_KEY must be saved locally in .env.local or supplied in the process environment.
npm run evaluate:models -- .local/evaluations/run/prepared.json .local/evaluations/run/results --run --budget=10
```

Preparation uses the production PDF worker. The dry run prepares the cost reservations without AI calls. Live mode first checks account access to selected model IDs, then sends identical page evidence and prompts to each selected model. The default pair remains GPT-4.1 and Sol; choose the current comparison explicitly with `--models=gpt-6.1-sol,gpt-6.1-terra,gpt-6-astra`. Each case can optionally specify a `models` array to limit Astra to preselected hard cases. It records input/output/reasoning/cache tokens, elapsed time, conservative budget cost, cache-discounted usage cost, separate schedule dimension and quantity matches, evidence omissions, validation issues and full private model results. The local budget is independent of production's monthly budget.

For a deliberately scoped diagnostic, `--models=gpt-6.1-sol` selects only Sol; use a separate output directory and subtract all earlier spending/reservations from the overall test budget. Incomplete Responses now retain reported token usage for cost accounting; transport failures without usage retain their reservation.

The runner writes a checkpoint **before** each paid request. Rerunning the same output directory skips completed, failed and uncertain attempts; it never silently retries a possible charge. Changed evidence, annotations or model configuration requires a new results directory. Review uncertainty and spending before deliberately starting a new attempt. An exclusive `.running` lock prevents simultaneous writers. After a hard interruption, confirm the old process has stopped before removing a stale lock; preserve all request checkpoints.

## Promotion gates

1. Both models must be available to the intended OpenAI project. All intended cases must complete without refusals, truncation or schema failures.
2. Compare source-referenced dimensions, tags, repeated quantities, units, scale and omissions. Review disagreements against visible drawing content, especially if embedded text conflicts.
3. Review floor shapes, walls, openings, courtyards, levels and roof decks visually. Passing sampled schedule facts or JSON validation does not establish geometry accuracy.
4. Test a multi-sheet project through assembly, editor, save and reopen. The independent-page runner deliberately supplies no previous context and cannot establish full workflow quality by itself.
5. Compare latency, actual usage and correction time. Keep unresolved geometry clearly marked. Do not promote a result just because the model is newer.

After these checks pass, update the web project's environment **together** and redeploy the reviewed candidate code:

```dotenv
OPENAI_MODEL=gpt-6.1-sol
OPENAI_REASONING_EFFORT=medium
OPENAI_INPUT_USD_PER_MILLION=2
OPENAI_OUTPUT_USD_PER_MILLION=10
```

Keep `OPENAI_API_KEY` server-side. Changing Vercel settings alone does not deploy this reasoning configuration. Do not change the worker's model settings; it performs PDF preparation only. Verify the new deployment and an authenticated test job before announcing the upgrade. Retain the previous deployment and its matching model/pricing values for rollback.

## Pipeline v2 and interpretation of results

PDF preparation writes a private normalized single-page copy: page rotation is transferred to content, CropBox origin is translated to zero, and both Poppler and pdfplumber consume that same copy. True line endpoints are clipped to the visible page; bounding-box corners are not endpoints. Evidence is tagged `evidenceVersion: 2` / `displayed-crop-points`. Older cached evidence is regenerated; the API provider refuses unversioned evidence. Deploy the updated worker before enabling this code in a hosted environment.

The AI observation contract accepts null dimensions and placement fields. Compilation preserves unresolved observations and only admits supported geometry to the editable model. Geometry with unresolved scale, dimensions, level, source region, or implausibly small sizes is withheld, with a review issue and retained raw observation. This prevents false precision but may produce no drawable shell; that is an omission, not a geometry-accuracy success.

`scheduleEntries` stores one row per source schedule row with nullable dimensions, `tagRole` and explicit `quantity`. Quantities never fabricate placed openings. Individual placed openings remain in `openings`; the UI displays source schedule rows separately. Both optional collections and unresolved observations survive model JSON persistence and export without breaking legacy models. Rows from separate sheets are retained with provenance rather than silently summed or merged.

Verified standard token rates per million (2026-11-09):

| Model | Input | Cached input | Output |
|---|---:|---:|---:|
| gpt-6.1-sol | $2 | $0.10 | $10 |
| gpt-6.1-terra | $1 | $0.05 | $5 |
| gpt-6-astra | $10 | $1 | $50 |

Sources: [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra).

Use medium reasoning, standard service tier, the same 24,000 output-token cap, identical prepared evidence, and no prior context for this comparison. Record which cases Astra sees before starting. Report the shared hard-case subset separately; do not compare its smaller denominator directly with the whole Sol/Terra suite. Record failure rate and missing geometry alongside factual accuracy. An unavailable or missing answer counts as not matched, not as an excluded sample. Observed cost for selected pages is not a full-PDF quote.

The provider parses the raw Responses result only after recording its status and usage, so malformed JSON or schema failures retain billable usage. Network failures without a response still have unknown actual cost and retain their budget reservation. No automatic paid retries are performed.

## Experimental cross-sheet shell (off by default)

`FRAAIME_SHELL_FUSION=1` opts a **new** extraction job into joint interpretation of 2–8 selected sheets. Leave it unset or `0` in production until the geometry review passes. This path explicitly uses `gpt-6.1-sol`, medium reasoning, standard service tier, and the verified Sol rates; it does not inherit another `OPENAI_MODEL` selection. Existing job checkpoints pin their processing mode on retry.

Select every enclosed floor plan plus relevant sections/elevations, then roof plans and schedules within the 24-sheet limit. Sheet selection is still human assisted. Each sheet can carry multiple drawing roles. The worker normalizes and caches each sheet separately before the joint call; large image payloads stay in private artifact storage rather than workflow history. Storage accepts legacy and versioned page artifact keys.

`src/lib/shell-provider.ts` asks for normalized full-page traces, printed dimension witness points, a shared physical anchor across floors, a project datum, section-backed heights, roof vertices, placed openings, schedule entries, and source evidence. Local dropped ceilings and other distinct height conditions belong in review issues, not in the same measurement as the primary exterior height. The provider returns data, never executable geometry code.

`src/lib/shell.ts` converts calibrated traces to millimeters and builds perimeter/courtyard walls, openings that fit supported walls, and supported roof surfaces. It rejects invalid/self-crossing outlines, intersecting voids, inconsistent or unsupported heights, incompatible floor anchors, and roof surfaces occupying courtyard interiors. Small rounding disagreements remain review issues; larger conflicts withhold geometry. Every trace remains inferred and every scale unconfirmed. Interior partitions, varying wall-top profiles, complete roof coverage, and complete opening placement are not guaranteed.

The workflow uses `ai_calls.page=0` as one job-level checkpoint; positive pages retain their legacy meaning. A completed joint result is assembled directly, preserving evidence from all supporting sheets. It must never pass through the legacy per-page evidence filter. Reservations happen before paid requests; uncertain calls cannot repeat automatically. Successful responses and billable failures record usage. Reruns remain separate candidates and never replace human edits.

A private evaluation manifest has this shape (paths are relative to the manifest):

```json
{
  "projects": [
    {
      "id": "synthetic-project",
      "pages": ["evidence/plan.json", "evidence/section.json"]
    }
  ]
}
```

Each evidence file is the worker's version 2 `PageEvidence` JSON. Do not put real evidence, manifest paths, model responses, or source-derived test fixtures in Git.

```sh
npm run evaluate:shells -- .local/evaluations/run/manifest.json .local/evaluations/run/results
npm run evaluate:shells -- .local/evaluations/run/manifest.json .local/evaluations/run/results --run --budget=20
```

Dry run makes no provider calls. Live mode checks account access, fingerprints evidence and compiler/provider code, locks the output directory, checkpoints before each request, and records per-project usage, costs, latency and geometry counts. Resume only with unchanged inputs/code; use a new results directory for intentional revisions. Unknown-cost requests retain their reservation. Account for previous result directories when authorizing a retest budget. Recompiling a saved structured draft after a compiler fix incurs no AI charge; keep the original response and record this separately from a fresh inference.

Before enabling this path, verify independently annotated floor separation and height facts, exterior outlines against source overlays, courtyard holes, roof-deck classification, opening placement, roof coverage, and correction time. A valid or nonempty model is not an accuracy pass. Tests cover joint request shape, mixed-role sheets, heights, voids, shared anchors, opening fit, checkpoint resumption, budget blocking, cancelled jobs, preserved evidence, and human-edit protection. Hosted end-to-end operation still needs verification on a preview deployment before production promotion.


## Interior partitions and roof completion (experimental)

Set `FRAAIME_SHELL_DETAILS=1` with `FRAAIME_SHELL_FUSION=1` for **new** jobs only. Both remain off by default. The second Sol/medium call receives the first pass's immutable level frames and the same selected plan, roof, section/elevation and schedule evidence. It adds interior wall runs and supported openings, and proposes a complete roof set. No customer geometry or fixtures are embedded in application code.

The contract uses normalized full floor-plan-page coordinates, calibrated to millimeters by application code. Roofs are planar outlines with optional holes, an elevation anchor, slope and uphill direction. Nominal low-slope surfaces are explicitly marked approximate when drainage facets cannot be recovered. Perimeter/courtyard walls and floors are retained; roof replacement cannot materially reduce sampled projected coverage. Interior wall heights may inherit a source-backed story height, with a review warning. Courtyard-crossing partitions, invalid openings and unsupported roof data remain unresolved observations. All generated geometry requires review.

The second call is a separate checkpoint (`page=-1`, base shell `page=0`). Both reserve against job/monthly spending limits. Completed checkpoints are reused, uncertain calls are never automatically repeated, and a failed detail step preserves the base result. Saved human revisions remain the project head; later AI jobs produce candidates. Existing base-only jobs keep that mode after a configuration change.

Run a private comparison against frozen baseline results:

```sh
npm run evaluate:shells -- /private/path/manifest.json /private/path/results --details
npm run evaluate:shells -- /private/path/manifest.json /private/path/results --details --run --budget=20
```

Each manifest project adds `baseModel` (compiled BuildingModel JSON) and `baseResult` (baseline response JSON containing `draft`) to the existing `id` and `pages`. Paths resolve relative to the manifest. Results contain raw observations, compiled model, source pages, actual token usage, cost, duration, geometry counts and validation findings. Input/code fingerprints and output locks prevent accidental reruns. Recompile retained observations to test deterministic geometry fixes without another provider charge.

Projected roof coverage measures enclosed floor area with an overhead roof surface. It does **not** establish drawing accuracy, drainage correctness, watertight junctions or engineering approval. Report wall tracing errors, roof slopes/elevations, unsupported items and source omissions separately. Customer files, overlays, models and reports stay under ignored `.local/` storage. Validate all four existing plans locally before enabling either flag in production.


Dense detail extraction streams Responses API lifecycle/output events and waits for a terminal response before parsing any model. A dropped stream preserves its response ID when available, records unknown usage, and never publishes partial JSON. It has a ten-minute overall API timeout and no automatic API retries. Before hosted activation, confirm the generated Workflow function's maximum duration supports this request plus checkpoint time; local CLI success does not verify the host's execution limit. A timeout without provider usage is **unknown spend**, retained at the conservative reservation until reconciled. For a deliberate follow-up evaluation in a new result directory, pass `--prior-results=/private/path/first-results` so the budget also includes previous completed and uncertain calls. Never replace an uncertain checkpoint with a fresh run.


## Three-stage hosted extraction (2026-11-10)

New hosted jobs with both shell flags enabled run a base shell, wall/roof detailing, then focused door/window matching. The third checkpoint is `page=-2`; it uses completed wall IDs and all selected schedule/plan evidence. All three calls use the configured Sol/medium provider and existing spend reservations. A failed opening pass preserves the detailed shell with an explicit partial-model issue. Existing completed jobs are pinned to their original stages and saved human revisions remain untouched. The CLI `--details` comparison above still evaluates the second stage only.

Suggested sheets now include recognized opening schedules and all primary architectural plans/elevations/sections, plus available cover, slab and roof-framing support within 24 pages. If primary sheets exceed the limit, the UI requires a deliberate selection instead of silently dropping them. Existing selections are retained; use **Use suggested sheets** to refresh them. OCR failures still require review or retry.

The detail contract supports independent exterior/garden enclosures without expanding the floor footprint, and source-backed piecewise wall-top profiles. Solid walls, studs, tracks, quantities and editable members use these profiles. Schedule entries with no or too few matching openings produce review warnings. These checks improve completeness detection; only source-sheet review establishes geometric accuracy. No new paid plan extraction was run for this release.
