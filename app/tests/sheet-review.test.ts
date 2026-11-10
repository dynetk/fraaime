import test from "node:test";
import assert from "node:assert/strict";
import { openLocal, uid, now } from "../src/lib/db";
import { saveSheetReview } from "../src/lib/sheet-review";
import {
  selectedPlanPages,
  optionalSheetPages,
  needsTitleOcr,
} from "../src/lib/sheet-selection";
import type { Manifest } from "../src/lib/worker";
const manifest = (): Manifest => ({
  sha256: "immutable-source",
  pageCount: 3,
  indexingComplete: true,
  warnings: [],
  sheets: ["FLOOR PLAN", "SECTION", "Unknown title"].map((text, i) => ({
    page: i + 1,
    text,
    kind: "unclassified",
    sheet: "",
    width: 100,
    height: 100,
    rotation: 0,
    revision: "",
    scanned: false,
  })),
});
test("unclassified pages default to unselected; optional selections persist", async () => {
  const db = await openLocal(),
    project = uid(),
    plan = uid();
  try {
    await db.query(
      "INSERT INTO projects(id,name,owner_email,created_at) VALUES($1,'Synthetic review','owner',$2)",
      [project, now()],
    );
    await db.query(
      "INSERT INTO plans(id,project_id,filename,storage_key,size_bytes,manifest,created_at) VALUES($1,$2,'synthetic.pdf','private',1,$3,$4)",
      [plan, project, JSON.stringify(manifest()), now()],
    );
    const read = async () =>
      (
        await db.query<{ manifest: Manifest }>(
          "SELECT manifest FROM plans WHERE id=$1",
          [plan],
        )
      ).rows[0].manifest;
    assert.deepEqual(selectedPlanPages(manifest(), undefined), [1, 2]);
    assert.equal(optionalSheetPages(manifest(), [1, 2]).length, 1);
    await saveSheetReview(db, plan, "owner", {
      page: 3,
      decision: "exclude",
      reason: "Reviewed source: general notes only",
    });
    let m = await read();
    assert.equal(optionalSheetPages(m, [1, 2]).length, 1);
    assert.equal(m.sheets[2].review?.by, "owner");
    // A later OCR update must not undo an explicit decision.
    m.sheets[2].text = "ROOF PLAN";
    assert.deepEqual(selectedPlanPages(m, undefined), [1, 2]);
    await saveSheetReview(db, plan, "owner", {
      page: 3,
      decision: "include",
      reason: "Needed roof detail",
    });
    m = await read();
    assert.deepEqual(selectedPlanPages(m, undefined, [1, 2]), [1, 2, 3]);
    await saveSheetReview(db, plan, "owner", {
      page: 3,
      decision: "reset",
      reason: "Check again",
    });
    m = await read();
    assert.deepEqual(selectedPlanPages(m, undefined), [1, 2]);
    await assert.rejects(
      saveSheetReview(db, plan, "owner", {
        page: 4,
        decision: "exclude",
        reason: "Not present",
      }),
      /outside/,
    );
    await assert.rejects(
      saveSheetReview(db, plan, "owner", {
        page: 3,
        decision: "exclude",
        reason: "",
      }),
    );
    assert.equal(
      (await db.query("SELECT id FROM audit WHERE action='sheet.reviewed'", []))
        .rows.length,
      3,
    );
    m.indexingComplete = false;
    await db.query("UPDATE plans SET manifest=$1 WHERE id=$2", [
      JSON.stringify(m),
      plan,
    ]);
    await assert.rejects(
      saveSheetReview(db, plan, "owner", {
        page: 3,
        decision: "exclude",
        reason: "Not relevant",
      }),
      /Wait for title indexing/,
    );
  } finally {
    await db.close?.();
  }
});

test("old unreadable OCR gets one upgraded attempt; current unreadable results stay reviewable", () => {
  const sheet = manifest().sheets[2];
  sheet.ocr = {
    version: 1,
    engine: "tesseract",
    status: "unreadable",
    text: "",
    lines: [],
  };
  assert(needsTitleOcr(sheet));
  sheet.ocr.version = 2;
  assert.equal(needsTitleOcr(sheet), false);
  assert.equal(
    optionalSheetPages({ ...manifest(), sheets: [sheet] }, []).length,
    1,
  );
});
