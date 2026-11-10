"use client";
import { useEffect, useId, useMemo, useState } from "react";
import type { BuildingModel } from "@/lib/model";
import {
  buildEstimate,
  dollars,
  estimateCsv,
  type Estimate,
} from "@/lib/estimate";
import {
  MOCK_ESTIMATE_SETTINGS,
  type EstimateSettings,
} from "@/lib/estimate-settings";
function NumberSetting({
  label,
  value,
  max = 100000,
  onCommit,
}: {
  label: string;
  value: number;
  max?: number;
  onCommit: (value: number) => void;
}) {
  const id = useId(),
    [draft, setDraft] = useState(String(value)),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(String(value));
    setError("");
  }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < 0 || next > max) {
      setError(
        `Enter a number from 0 to ${max}. The previous value is still used.`,
      );
      setDraft(String(value));
      return;
    }
    setError("");
    if (next !== value) onCommit(next);
  };
  return (
    <label className="estimate-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        min="0"
        max={max}
        step="0.01"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-invalid={!!error}
        aria-describedby={error ? id + "-error" : undefined}
      />
      {error && (
        <small id={id + "-error"} className="error-text" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
export default function EstimatePanel({
  model,
  revision,
  dirty,
  onSettings,
}: {
  model: BuildingModel;
  revision: string | null;
  dirty: boolean;
  onSettings: (settings: EstimateSettings) => void;
}) {
  const settings = model.estimate ?? MOCK_ESTIMATE_SETTINGS;
  const result = useMemo<{ estimate?: Estimate; error?: string }>(() => {
    try {
      return { estimate: buildEstimate(model) };
    } catch (e) {
      return {
        error:
          e instanceof Error ? e.message : "Estimate could not be calculated.",
      };
    }
  }, [model]);
  const estimate = result.estimate;
  const changeRate = (key: keyof EstimateSettings["rates"], value: number) =>
    onSettings({ ...settings, rates: { ...settings.rates, [key]: value } });
  const download = (format: "csv" | "json") => {
    if (!estimate) return;
    const payload =
      format === "csv"
        ? estimateCsv(estimate, revision, dirty)
        : JSON.stringify(
            {
              ...estimate,
              revisionId: revision,
              unsavedChanges: dirty,
              generatedAt: new Date().toISOString(),
            },
            null,
            2,
          );
    const url = URL.createObjectURL(
      new Blob([payload], {
        type: format === "csv" ? "text/csv;charset=utf-8" : "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `fraaime-mock-estimate.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="panel estimate-panel">
      <div className="estimate-heading">
        <div>
          <span className="badge">MOCK PRICING · USD</span>
          <h2>Preliminary framing estimate</h2>
          <p>
            Turn the current model into a budget conversation. Fictional rates
            and illustrative quantities—not a supplier quote or a whole-project
            construction price.
          </p>
        </div>
        <div className="actions">
          <button disabled={!estimate} onClick={() => download("csv")}>
            Export estimate CSV
          </button>
          <button disabled={!estimate} onClick={() => download("json")}>
            Export estimate JSON
          </button>
        </div>
      </div>
      <p className="fineprint">
        All modeled levels are included, even when hidden in the viewer.{" "}
        {dirty
          ? "Includes unsaved changes. Save changes above to keep these rates and scope with the model."
          : "Rates and scope save with the model revision using Save revision above."}{" "}
        {revision
          ? `Based on revision ${revision.slice(0, 8)}.`
          : "No saved revision yet."}
      </p>
      {result.error && (
        <p className="error-text" role="alert">
          {result.error} No total is available.
        </p>
      )}
      {estimate && (
        <>
          <div className="estimate-summary">
            <div className="estimate-total">
              <span>Mock framing total · tax excluded</span>
              <strong data-testid="estimate-total">
                {dollars(estimate.total)}
              </strong>
              <small>
                {estimate.quantities.length.toLocaleString()} illustrative
                member segments
              </small>
            </div>
            <div>
              <span>Materials incl. waste</span>
              <strong>{dollars(estimate.materials)}</strong>
              <small>{settings.wastePercent}% material allowance</small>
            </div>
            <div>
              <span>Installation labor</span>
              <strong>{dollars(estimate.labor)}</strong>
              <small>
                {settings.includeLabor
                  ? "Mock area-based allowance"
                  : "Excluded from scope"}
              </small>
            </div>
          </div>
          {!estimate.quantities.length && (
            <p className="notice">
              No framing quantities in the selected scope. Add walls or framing
              members, or include modeled floor/roof framing below.
            </p>
          )}
          {(estimate.unresolvedIssues > 0 ||
            estimate.unconfirmedScales > 0 ||
            estimate.unpricedBoxes > 0) && (
            <p className="estimate-caution">
              Model review needed: {estimate.unresolvedIssues} unresolved issues
              · {estimate.unconfirmedScales} unconfirmed scales ·{" "}
              {estimate.unpricedBoxes} unpriced generic boxes. Missing or
              inferred geometry changes this budget.
            </p>
          )}
        </>
      )}
      <div className="estimate-settings">
        <fieldset>
          <legend>Estimate scope</legend>
          <label>
            <input
              type="checkbox"
              checked={settings.includeFloorFraming}
              onChange={(e) =>
                onSettings({
                  ...settings,
                  includeFloorFraming: e.target.checked,
                })
              }
            />{" "}
            Include automatic floor framing
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.includeRoofFraming}
              onChange={(e) =>
                onSettings({
                  ...settings,
                  includeRoofFraming: e.target.checked,
                })
              }
            />{" "}
            Include automatic roof framing (not roof decks)
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.includeLabor}
              onChange={(e) =>
                onSettings({ ...settings, includeLabor: e.target.checked })
              }
            />{" "}
            Include mock installation labor
          </label>
          <label className="estimate-field">
            <span>Framing spacing</span>
            <select
              aria-label="Estimate framing spacing"
              value={settings.spacingMm}
              onChange={(e) =>
                onSettings({
                  ...settings,
                  spacingMm: Number(e.target.value) as 406.4 | 609.6,
                })
              }
            >
              <option value={406.4}>16 in. on center</option>
              <option value={609.6}>24 in. on center</option>
            </select>
          </label>
          <p className="fineprint">
            Wall framing and all manually edited/added framing members are
            included. Custom wall layouts retain their saved spacing. Floor
            framing is off by default; a floor outline does not establish that
            steel joists are needed.
          </p>
        </fieldset>
        <fieldset>
          <legend>Mock unit prices</legend>
          <div className="estimate-input-grid">
            {(
              [
                ["stud", "Studs · $/LF"],
                ["track", "Tracks · $/LF"],
                ["header", "Headers · $/LF"],
                ["joist", "Joists / perimeter · $/LF"],
                ["wallLabor", "Wall installation · $/SF"],
                ["floorLabor", "Floor installation · $/SF"],
                ["roofLabor", "Roof installation · $/SF"],
              ] as const
            ).map(([key, label]) => (
              <NumberSetting
                key={key}
                label={label}
                value={settings.rates[key]}
                onCommit={(value) => changeRate(key, value)}
              />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Allowances</legend>
          <div className="estimate-input-grid">
            <NumberSetting
              label="Material waste %"
              value={settings.wastePercent}
              max={100}
              onCommit={(value) =>
                onSettings({ ...settings, wastePercent: value })
              }
            />
            <NumberSetting
              label="Delivery allowance · $"
              value={settings.delivery}
              onCommit={(value) => onSettings({ ...settings, delivery: value })}
            />
            <NumberSetting
              label="Contingency %"
              value={settings.contingencyPercent}
              max={100}
              onCommit={(value) =>
                onSettings({ ...settings, contingencyPercent: value })
              }
            />
            <NumberSetting
              label="Markup % (not margin)"
              value={settings.markupPercent}
              max={100}
              onCommit={(value) =>
                onSettings({ ...settings, markupPercent: value })
              }
            />
          </div>
          <p className="fineprint">
            Contingency applies to materials + labor + delivery. Markup applies
            after contingency. No delivery is charged on an empty takeoff.
          </p>
        </fieldset>
      </div>
      {estimate && (
        <>
          <div className="estimate-table">
            <table>
              <caption>
                Model-based quantities and fictional prices · LF = linear feet,
                SF = square feet
              </caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Model quantity</th>
                  <th scope="col">With waste</th>
                  <th scope="col">Mock unit price</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {estimate.lines.map((line) => (
                  <tr key={line.id}>
                    <th scope="row">
                      {line.label}
                      <small>{line.category}</small>
                    </th>
                    <td>
                      {line.quantity.toLocaleString()} {line.unit}
                    </td>
                    <td>
                      {line.billableQuantity.toLocaleString()} {line.unit}
                    </td>
                    <td>
                      {dollars(line.rate)} / {line.unit}
                    </td>
                    <td>{dollars(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="estimate-totals">
            {[
              ["Delivery", estimate.delivery],
              ["Direct subtotal", estimate.direct],
              [
                `Contingency (${settings.contingencyPercent}%)`,
                estimate.contingency,
              ],
              [`Markup (${settings.markupPercent}%)`, estimate.markup],
              ["Mock total · tax excluded", estimate.total],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>{dollars(Number(value))}</dd>
              </div>
            ))}
          </dl>
          <details className="estimate-assumptions" open>
            <summary>Assumptions, exclusions, and quantity basis</summary>
            <p>
              {estimate.wallArea.toLocaleString()} SF gross framed wall area ·{" "}
              {estimate.floorArea.toLocaleString()} SF included net floor area ·{" "}
              {estimate.roofArea.toLocaleString()} SF included net sloped roof
              area.
            </p>
            <ul>
              {estimate.exclusions.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p>
              Export CSV or JSON for a member-by-member quantity list linked to
              model element IDs. Confirm dimensions, member specifications,
              scope, and supplier pricing with an estimator before issuing a
              real quote.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
