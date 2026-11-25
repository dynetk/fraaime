"use client";
import { useState } from "react";
import type { BuildingModel } from "@/lib/model";
import {
  feetInches,
  individualHeightNeeded,
  previewRoomTrusses,
  roomName,
} from "@/lib/truss-review";

export default function TrussHeightReview({
  model,
  levelId,
  onChange,
  onError,
  onEdit,
}: {
  model: BuildingModel;
  levelId: string;
  onChange: (m: BuildingModel) => void;
  onError: (s: string) => void;
  onEdit: (id: string) => void;
}) {
  const level = model.levels.find((l) => l.id === levelId);
  const rooms = (model.trussZones ?? []).filter(
    (z) =>
      z.levelId === levelId &&
      !z.confirmed &&
      z.members === undefined &&
      z.kind !== "slab-on-grade",
  );
  const [selected, setSelected] = useState(() =>
    rooms.filter((z) => !individualHeightNeeded(z)).map((z) => z.id),
  );
  const [height, setHeight] = useState(() =>
    level ? String(+(level.height / 304.8).toFixed(4)) : "",
  );
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{
    input: BuildingModel;
    result: ReturnType<typeof previewRoomTrusses>;
  } | null>(null);
  const [message, setMessage] = useState("");
  if (!level) return null;
  const result = preview?.input === model ? preview.result : null;
  const change = () => {
    setPreview(null);
    setMessage("");
  };
  const chosen = rooms.filter((z) => selected.includes(z.id));
  const available = rooms.filter((z) => !z.heightUnresolved).length;
  const sources = level.evidence.filter((e) =>
    /ceiling|height|plate|section/i.test(e.note),
  );
  const run = () => {
    try {
      const result = previewRoomTrusses(model, {
        levelId,
        zoneIds: chosen.map((z) => z.id),
        suggestedHeightMm: height.trim() ? Number(height) * 304.8 : null,
        overrides: Object.fromEntries(
          Object.entries(overrides)
            .filter(([, v]) => v.trim())
            .map(([id, v]) => [id, Number(v) * 304.8]),
        ),
        note,
        suggestedBasis:
          Math.abs(Number(height) * 304.8 - level.height) < 1
            ? "floor-model"
            : "reviewer-entered",
      });
      setPreview({ input: model, result });
      setMessage("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  if (!rooms.length)
    return (
      <p role="status">
        {message ||
          "All rooms on this floor have been added. Save changes to keep your model."}
      </p>
    );
  return (
    <section className="height-review" aria-label="Truss setup">
      <div className="truss-review-heading">
        <h3>Generate room trusses</h3>
        <span>{level.label}</span>
      </div>
      <p>
        {available} rooms already have a height. For the others, review the
        suggested height below. Known heights are kept; room outlines are fitted
        to nearby modeled walls.
      </p>
      <div className="truss-review-height">
        <div>
          <strong>1. Check the suggested ceiling height</strong>
          <p className="fineprint">
            From this floor’s model: {feetInches(level.height)}. This is a
            suggestion for rooms without a height, not a room-specific
            measurement. Garages and other special-height rooms need their own
            entry.
          </p>
        </div>
        <label className="field">
          Suggested ceiling height · ft
          <input
            type="number"
            step="0.01"
            min="0.01"
            max="98.42"
            value={height}
            onChange={(e) => {
              setHeight(e.target.value);
              change();
            }}
          />
          <small>
            {Number(height) > 0
              ? feetInches(Number(height) * 304.8)
              : "Enter a height, or preview only rooms with detected heights."}
          </small>
        </label>
      </div>
      <details>
        <summary>Why are some heights missing? See drawing references</summary>
        <p>
          Room outlines come from floor plans. Ceiling heights usually come from
          sections or ceiling plans. A typical floor height may be readable
          without a reliable match to each room. “Suggested” means that match
          still needs your review; “Detected” means the extraction supplied a
          room height. Model dimensions are approximate until checked.
        </p>
        {sources.length ? (
          sources.map((e, i) => (
            <p className="fineprint" key={i}>
              <a
                href={`/api/plans/${encodeURIComponent(e.planId)}/source#page=${e.page}`}
                target="_blank"
                rel="noreferrer"
              >
                {e.sheet} · page {e.page} ↗
              </a>{" "}
              — {e.note}
            </p>
          ))
        ) : (
          <p className="fineprint">
            No separate ceiling-height citation was saved for this floor. Check
            the source drawings before using its height.
          </p>
        )}
      </details>
      <div className="truss-review-heading">
        <strong>2. Choose rooms</strong>
        <div className="actions">
          <button
            onClick={() => {
              setSelected(
                rooms
                  .filter((z) => !individualHeightNeeded(z))
                  .map((z) => z.id),
              );
              change();
            }}
          >
            Select suggested rooms
          </button>
          <button
            onClick={() => {
              setSelected([]);
              change();
            }}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="truss-review-rooms">
        {rooms.map((z) => {
          const special = individualHeightNeeded(z),
            override = overrides[z.id];
          const mm = z.heightUnresolved
            ? override?.trim()
              ? Number(override) * 304.8
              : special
                ? null
                : height.trim()
                  ? Number(height) * 304.8
                  : null
            : z.ceilingHeight;
          const origin = !z.heightUnresolved
            ? z.heightReview
              ? "Entered"
              : "Detected"
            : override?.trim()
              ? "Entered"
              : mm !== null
                ? Math.abs(Number(height) * 304.8 - level.height) < 1
                  ? "Suggested"
                  : "Entered"
                : "Needs a height";
          return (
            <div className="truss-review-room" key={z.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(z.id)}
                  onChange={(e) => {
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, z.id]
                        : ids.filter((id) => id !== z.id),
                    );
                    change();
                  }}
                />
                <strong>{roomName(z.label)}</strong>
              </label>
              <span
                className={`height-origin ${origin === "Detected" ? "detected" : ""}`}
              >
                {origin}
                {mm !== null && Number.isFinite(mm) && mm > 0
                  ? ` · ${feetInches(mm)}`
                  : ""}
              </span>
              <span className="fineprint">
                Model size: {feetInches(z.width)} × {feetInches(z.depth)}
              </span>
              {z.heightUnresolved && (
                <details open={special || undefined}>
                  <summary>
                    {special
                      ? "Enter a separate height"
                      : "Use a different height"}
                  </summary>
                  <label className="field">
                    {roomName(z.label)} ceiling height · ft
                    <input
                      type="number"
                      min="0.01"
                      max="98.42"
                      step="0.01"
                      value={override ?? ""}
                      placeholder={
                        special
                          ? "Required for this room"
                          : "Use suggested height"
                      }
                      onChange={(e) => {
                        setOverrides((v) => ({ ...v, [z.id]: e.target.value }));
                        change();
                      }}
                    />
                  </label>
                </details>
              )}
            </div>
          );
        })}
      </div>
      <details>
        <summary>Add a note (optional)</summary>
        <label className="field">
          Review note
          <input
            value={note}
            maxLength={1000}
            placeholder="Drawing reference or explanation"
            onChange={(e) => {
              setNote(e.target.value);
              change();
            }}
          />
        </label>
      </details>
      <div className="truss-review-primary">
        <button disabled={!chosen.length} onClick={run}>
          Preview trusses for {chosen.length}{" "}
          {chosen.length === 1 ? "room" : "rooms"}
        </button>
        <span className="fineprint">
          {chosen.length
            ? "Preview checks heights and wall connections. No changes are saved yet."
            : "Select at least one room above to continue."}
        </span>
      </div>
      {result && (
        <section className="truss-review-result" aria-label="Truss preview">
          <h4>
            {result.ready} of {result.rooms.length} rooms ready
          </h4>
          <p>
            {result.memberCount} members · {result.linearFeet.toFixed(2)} LF to
            add
          </p>
          {result.ready > 0 && (
            <details>
              <summary>Rooms ready to add — heights and fitted sizes</summary>
              <ul>
                {result.rooms
                  .filter((r) => r.status === "ready")
                  .map((r) => {
                    const fitted = result.model.trussZones!.find(
                      (z) => z.id === r.id,
                    )!;
                    return (
                      <li key={r.id}>
                        <strong>{r.name}</strong>: {feetInches(r.heightMm!)}{" "}
                        ceiling ({r.origin}); {feetInches(fitted.width)} ×{" "}
                        {feetInches(fitted.depth)} fitted room.
                      </li>
                    );
                  })}
              </ul>
            </details>
          )}
          {result.rooms
            .filter((r) => r.status !== "ready")
            .map((r) => (
              <div className="truss-review-problem" key={r.id}>
                <strong>{r.name}</strong>
                <span>
                  {r.status === "height-needed"
                    ? "Enter a ceiling height above."
                    : "The room does not yet fit the modeled walls."}
                </span>
                {r.status === "geometry-needed" && (
                  <button onClick={() => onEdit(r.id)}>Adjust this room</button>
                )}
                <details>
                  <summary>Details</summary>
                  <p className="fineprint">{r.message}</p>
                </details>
              </div>
            ))}
          <p className="fineprint">
            Adding accepts the displayed heights and fitted boundaries for these
            draft trusses. Suggested heights stay labeled in the saved model.
            This is not engineering approval.
          </p>
          <button
            disabled={!result.ready}
            onClick={() => {
              onChange(result.model);
              setPreview(null);
              setMessage(
                `Added trusses for ${result.ready} ${result.ready === 1 ? "room" : "rooms"}. Save changes to keep them.`,
              );
            }}
          >
            Add {result.ready} {result.ready === 1 ? "room" : "rooms"} to model
          </button>
          {!result.ready && (
            <p role="status">
              Nothing added. Resolve the items above, then preview again.
            </p>
          )}
        </section>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
