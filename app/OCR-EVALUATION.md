# Local OCR and sheet-selection comparison

This benchmark compares native PDF text, the existing native-first title OCR fallback, title OCR alone, and full-page OCR alone. It does not call an LLM, generate geometry, change production settings, or connect to the application database. Tesseract runs locally: AI API spend is zero, but CPU time and hosted infrastructure are not free.

## Prepare private inputs

Install the PDF worker dependencies and make `pdftoppm` and Tesseract with English language data available. `TESSERACT_CMD` may point to a custom Tesseract executable. Keep original PDFs, OCR text, annotations, and results in ignored `.local/` storage; never commit customer material.

Create `.local/ocr-comparison/cases.json`:

```json
[{ "name": "sample", "pdf": "/private/path/plan-set.pdf" }]
```

Use unique, lowercase case identifiers. Review the original drawings before inspecting OCR output. Create a reference file with the exact PDF hash and one-based **PDF page numbers**, not printed sheet numbers:

```json
{
  "version": 1,
  "scope": "Primary architectural floor, roof, exterior elevation and building-section sheets for a whole-building shell",
  "review": "Describe who checked the original sheets and how",
  "cases": [
    {
      "name": "sample",
      "sha256": "exact-source-sha256",
      "pageCount": 3,
      "core": { "1": "floor-plan", "2": "roof-plan", "3": "section" },
      "notes": {}
    }
  ]
}
```

Record supplementary details separately in `notes`. Interior elevations, unused drawings, civil details and incidental captions can resemble core titles without being primary shell evidence. A non-core candidate is not necessarily useless or incorrectly transcribed.

Create a separate text reference. Transcribe labels and dimensions visually before reading machine output, and keep difficult examples in the sample:

```json
{
  "method": "Visually transcribed facts; presence on a page, not spatial association",
  "cases": [
    {
      "name": "sample",
      "page": 1,
      "facts": [
        { "kind": "label", "text": "KITCHEN" },
        { "kind": "dimension", "text": "12'-6\"" }
      ]
    }
  ]
}
```

## Run and report

From the application directory:

```sh
worker/.venv/bin/python scripts/benchmark-ocr.py \
  --cases .local/ocr-comparison/cases.json \
  --out .local/ocr-comparison/run \
  --workers 3

node --import tsx scripts/report-ocr-comparison.ts \
  .local/ocr-comparison/run \
  .local/ocr-comparison/reference.json \
  .local/ocr-comparison/text-reference.json
```

The first command inspects each PDF and processes **every page**, including pages production would skip. Checkpoints are reused only when the source hash and OCR/script fingerprint match. The second command checks source hashes and fingerprints and writes `comparison.json` alongside the raw checkpoints. Use a fresh directory for a clean timing run; a resumed run's wall time includes cached work differently.

## What each comparison measures

| Mode               | Evidence passed to the unchanged sheet selector                                 |
| ------------------ | ------------------------------------------------------------------------------- |
| Native             | Production index text and native kind hints, without OCR                        |
| Hybrid             | Native evidence plus title OCR only for pages where `needsTitleOcr` requests it |
| Title OCR only     | No native text; the production title OCR result on every page                   |
| Full-page OCR only | No native text; complete OCR text from a 3600-pixel page render                 |

The title pass uses the production crop, rotation, confidence and timeout behavior. The experimental full-page pass uses English Tesseract PSM 11, the orientation found by the title pass, and no word-confidence filter. It therefore depends on title-pass orientation and is not an independent end-to-end OCR implementation. Full-page OCR is not enabled in the production extraction pipeline by this benchmark.

Report both **uncapped core-sheet discovery** and the **final selected set**. Primary sheets are no longer silently truncated: sets above the 24-sheet limit require manual selection. Supplementary sheets are added only while capacity remains. Historical reports may reflect the earlier eight-sheet cap; record the selector revision when comparing results. Also inspect wrong-kind classifications and non-core candidates. Tesseract confidence is not an accuracy percentage, and successful execution does not mean a title was read correctly.

The text sample compares the production index's native text (up to 12,000 characters per page) with full-page OCR. It normalizes case, whitespace, dash separators, quote style and Unicode fraction forms, but requires numeric values and foot/inch marks to survive. It measures exact fact presence, not reading order, wall association, scale, geometry, or whole-document accuracy. It is not a test of the separate PDF preparation step's richer native/vector evidence.

Timing fields are sums of page-operation seconds unless labeled wall time. Concurrent work means summed operation time is greater than elapsed time. Full-page OCR timing excludes the title pass it uses for orientation. Do not translate local timings into cloud bills without measuring the deployed worker.

## Decisions this can support

- Whether title OCR recovers core sheets missing from native indexing.
- Whether replacing native text with OCR loses otherwise readable information.
- Whether title classification, exclusion rules, or the selection cap needs improvement.
- Which failures deserve a later, separately authorized end-to-end AI/model evaluation.

This benchmark cannot establish model dimensional accuracy, framing completeness, estimate accuracy, or paid model cost. Those require the separate workflow in [EVALUATION.md](EVALUATION.md).

## Title recognition v2 and the review gate

Version 2 reads smaller title-block and sheet-edge crops before a bounded low-resolution full-page fallback. It tests four orientations, joins adjacent multiline titles, and recognizes combined schedules/details and roof-framing titles. Rendering is limited to 60 seconds, recognition to 90 seconds total and 12 seconds per attempt. The OCR endpoint separately bounds PDF download to 90 seconds. Results record attempt count, timed-out attempts and duration; an unresolved timeout is still reported, not relabeled as success.

New indexing uses v2. Retry indexing upgrades old failed/unreadable title results, while retaining successful results and human review decisions. The app accepts v1 and v2 during staged deployment. The PDF worker must be redeployed as well as the web app.

Unclassified pages are unselected by default. Suggested sheets can be processed without reviewing or explicitly excluding the rest of the PDF. The optional drawing list keeps unknown/OCR-failed pages visible; selecting a checkbox includes that page as evidence despite title-reading failure. Checkbox choices are saved against the plan revision and survive reloads and OCR retries. Existing exclusions remain respected. There is no unclassified-page gate in the UI or API. Existing extraction checkpoints retain their original sheets when resumed; changing sheets requires a new draft.

Run a title-only comparison without paid AI calls:

```sh
worker/.venv/bin/python scripts/benchmark-ocr.py --cases /private/cases.json \
  --out /private/title-v2 --workers 3 --title-only \
  --native-cache /private/baseline/native.json
node --import tsx scripts/compare-title-ocr.ts /private/baseline \
  /private/title-v2 /private/reference.json
```

Cached native manifests require matching source hashes. Reports reject mixed OCR fingerprints and compare both runs through the same current sheet selector, isolating OCR changes from the earlier sheet-limit change. Counts cover completed, unreadable and failed title reads, selected reference sheets, wrong classifications and remaining manual review. Full-page OCR and model geometry are outside this title-only test. Local CPU timings do not establish hosted latency or accuracy.
