import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PlanProcessing from "../src/components/PlanProcessing";
import {
  processingAttempts,
  type ProcessingJob,
} from "../src/lib/processing-jobs";
const job = (
  id: string,
  state = "needs_selection",
  day = 1,
): ProcessingJob => ({
  id,
  plan_id: "plan",
  state,
  phase: `Phase ${id}`,
  error: null,
  pages: [1, 2],
  completed_pages: [],
  spend: "0",
  created_at: `2026-11-${String(day).padStart(2, "0")}T12:00:00Z`,
});
const render = (jobs: ProcessingJob[], indexing = false) =>
  renderToStaticMarkup(
    createElement(PlanProcessing, {
      jobs,
      planId: "plan",
      busy: false,
      indexing,
      onRun: () => {},
      onNew: () => {},
      onCancel: () => {},
    }),
  );
test("duplicate ready records show one action and collapsed read-only history", () => {
  const html = render([job("older"), job("newer", "needs_selection", 2)]);
  assert.equal((html.match(/>Process selected sheets</g) || []).length, 1);
  assert.match(html, /Processing history \(1 earlier attempt\)/);
  assert.match(html, /<details class="processing-history">/);
  assert(html.indexOf("Phase newer") < html.indexOf("Phase older"));
  assert.doesNotMatch(html.split("<details")[1], /<button/);
});
test("newest attempt is scoped by PDF without mutating server records", () => {
  const jobs = [
    job("old"),
    { ...job("other", "extracting", 3), plan_id: "other" },
    job("new", "needs_selection", 2),
  ];
  assert.deepEqual(
    processingAttempts(jobs, "plan").map((j) => j.id),
    ["new", "old"],
  );
  assert.equal(jobs[0].id, "old");
  assert.equal(render([]), "");
  assert.doesNotMatch(render([job("only")]), /Processing history/);
});
test("latest failed attempt keeps retry controls and prior errors and costs remain readable", () => {
  const html = render([
    { ...job("old", "failed"), error: "Preparation failed", spend: "0.25" },
    job("new", "failed", 2),
  ]);
  assert.equal((html.match(/>Resume processing</g) || []).length, 1);
  assert.equal((html.match(/>Start separate extraction</g) || []).length, 1);
  assert.match(html, /Preparation failed/);
  assert.match(html, /\$0.250/);
});
test("older active attempt is visible and cancellable while new extraction stays disabled", () => {
  const html = render([
    job("old", "extracting"),
    job("new", "needs_selection", 2),
  ]);
  assert.match(html, /<details class="processing-history" open="">/);
  assert.match(html, /<button disabled="">Process selected sheets/);
  assert.match(html, />Cancel earlier attempt</);
  assert.doesNotMatch(
    html.split("<details")[1],
    /Resume processing|Process selected sheets/,
  );
});
test("latest active job retains cancel; indexing disables a fresh run", () => {
  assert.match(render([job("active", "preparing")]), />Cancel</);
  assert.doesNotMatch(
    render([job("active", "extracting")]),
    />Resume processing</,
  );
  assert.match(
    render([job("new")], true),
    /<button disabled="">Process selected sheets/,
  );
});
