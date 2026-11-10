import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("OCR report separates recognition, selection cap, and exact text presence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fraaime-ocr-report-"));
  const json = (name: string, value: unknown) =>
    writeFile(join(dir, name), JSON.stringify(value));
  try {
    const sheets = Array.from({ length: 26 }, (_, index) => ({
      page: index + 1,
      kind: "unclassified",
      text: index === 0 ? "FLOOR PLAN\nKITCHEN\n17'-6\"" : "ELEVATIONS",
    }));
    await json("native.json", [
      {
        name: "sample",
        sha256: "source",
        nativeSeconds: 1,
        manifest: { pageCount: 26, sheets },
      },
    ]);
    await json("run.json", { fingerprint: "version" });
    await json("reference.json", {
      cases: [
        {
          name: "sample",
          sha256: "source",
          core: Object.fromEntries(
            sheets
              .slice(0, 25)
              .map((s) => [s.page, s.page === 1 ? "floor-plan" : "elevation"]),
          ),
          notes: {},
        },
      ],
    });
    await json("text.json", {
      cases: [
        {
          name: "sample",
          page: 1,
          facts: [
            { kind: "label", text: "KITCHEN" },
            { kind: "dimension", text: "7'-6\"" },
            { kind: "dimension", text: "17'-6\"" },
          ],
        },
      ],
    });
    for (const sheet of sheets)
      await json(`sample-${sheet.page}.json`, {
        sha256: "source",
        fingerprint: "version",
        titleSeconds: 2,
        title: {
          status: "complete",
          lines: [
            {
              text: sheet.page === 1 ? "FLOOR PLAN" : "ELEVATIONS",
              confidence: 90,
            },
          ],
        },
        full: {
          status: "complete",
          text: sheet.page === 1 ? 'FLOOR PLAN\nKITCHEN\n17-6"' : "ELEVATIONS",
          seconds: 3,
        },
      });
    const execute = () =>
      spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("scripts/report-ocr-comparison.ts"),
          dir,
          join(dir, "reference.json"),
          join(dir, "text.json"),
        ],
        { encoding: "utf8" },
      );
    const execution = execute();
    assert.equal(execution.status, 0, execution.stderr);
    const report = JSON.parse(
      await readFile(join(dir, "comparison.json"), "utf8"),
    );
    const result = report.results[0];
    assert.equal(result.modes.native.coreFound, 25);
    assert.equal(result.modes.native.selectedCore, 25);
    assert.deepEqual(result.modes.native.omittedByCap, []);
    assert.deepEqual(result.modes.native.nonCoreCandidates, [26]);
    assert.equal(result.selectiveOcr.pages, 0);
    assert.equal(result.allPageTitleOcr.pages, 26);
    assert.equal(result.textSample.nativeHits, 2);
    assert.equal(result.textSample.ocrHits, 1);
    assert.equal(
      result.textSample.facts[1].native,
      false,
      "7 feet must not match inside 17 feet",
    );
    assert.equal(
      result.textSample.facts[2].ocr,
      false,
      "missing foot mark is not an exact dimension match",
    );
    await json("run.json", { fingerprint: "stale-version" });
    const stale = execute();
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /Stale OCR checkpoint/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
