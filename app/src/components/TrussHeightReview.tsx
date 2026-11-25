"use client";
import { useState } from "react";
import type { BuildingModel } from "@/lib/model";
import { reviewRoomHeights } from "@/lib/truss-height-review";

export default function TrussHeightReview({
  model,
  levelId,
  onChange,
  onError,
}: {
  model: BuildingModel;
  levelId: string;
  onChange: (m: BuildingModel) => void;
  onError: (s: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [height, setHeight] = useState("");
  const [note, setNote] = useState("");
  const [basis, setBasis] = useState<"floor-model" | "reviewer-entered">(
    "reviewer-entered",
  );
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const level = model.levels.find((l) => l.id === levelId);
  const rooms = (model.trussZones ?? []).filter(
    (z) =>
      z.levelId === levelId &&
      !z.confirmed &&
      z.members === undefined &&
      z.kind !== "slab-on-grade",
  );
  if (!level || !rooms.length) return null;
  const chosen = rooms.filter((z) => selected.includes(z.id));
  const apply = (generate: boolean) => {
    try {
      const result = reviewRoomHeights(model, {
        levelId,
        zoneIds: chosen.map((z) => z.id),
        heightMm: Number(height) * 304.8,
        basis,
        note,
        generate,
      });
      onChange(result.model);
      setMessage(
        `${result.heightsApplied} missing heights filled. ${generate ? `${result.generatedRooms} rooms generated; ${result.messages.length} still need geometry review.` : "Review the boundaries, then fit and generate. Existing heights were preserved."} Save revision to keep these changes.`,
      );
      setProblems(result.messages);
      setReviewed(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className="height-review" aria-label="Resolve room heights">
      <h3>Resolve heights together</h3>
      <p>
        {level.label}: {rooms.filter((z) => z.heightUnresolved).length} rooms
        need heights; {rooms.filter((z) => !z.heightUnresolved).length} have
        heights and await review.
      </p>
      <p className="fineprint">
        The floor model height is {(level.height / 304.8).toFixed(2)} ft. It may
        describe wall or plate height rather than the room ceiling. Check
        sections or ceiling plans before applying it. Select only rooms with
        this height; review garages, dropped ceilings and different floor datums
        separately.
      </p>
      <div className="actions">
        <button
          onClick={() => {
            setHeight(String(+(level.height / 304.8).toFixed(4)));
            setBasis("floor-model");
            setNote(
              "Floor model height reviewed against room ceiling drawings.",
            );
            setReviewed(false);
          }}
        >
          Use floor model height
        </button>
        <button
          onClick={() => {
            setSelected(
              rooms.filter((z) => z.heightUnresolved).map((z) => z.id),
            );
            setReviewed(false);
          }}
        >
          Select rooms missing heights
        </button>
        <button
          onClick={() => {
            setSelected([]);
            setReviewed(false);
          }}
        >
          Clear room selection
        </button>
      </div>
      <div className="truss-zone-fields">
        <label className="field">
          Reviewed ceiling height · ft
          <input
            type="number"
            min="0.01"
            max="98.42"
            step="0.01"
            value={height}
            onChange={(e) => {
              setHeight(e.target.value);
              setBasis("reviewer-entered");
              setReviewed(false);
            }}
          />
        </label>
        <label className="field">
          Height source / review note
          <input
            maxLength={1000}
            value={note}
            placeholder="e.g. A4.00, typical flat ceiling, 10 ft 6 in"
            onChange={(e) => {
              setNote(e.target.value);
              setReviewed(false);
            }}
          />
        </label>
      </div>
      <div className="height-room-list">
        {rooms.map((z) => (
          <label key={z.id}>
            <input
              type="checkbox"
              checked={selected.includes(z.id)}
              onChange={(e) => {
                setSelected((ids) =>
                  e.target.checked
                    ? [...ids, z.id]
                    : ids.filter((id) => id !== z.id),
                );
                setReviewed(false);
              }}
            />{" "}
            {z.label}{" "}
            <span className="fineprint">
              {z.heightUnresolved
                ? "— height required"
                : `— ${(z.ceilingHeight / 304.8).toFixed(2)} ft (preserved)`}
            </span>
          </label>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />{" "}
        I checked the selected rooms’ ceiling heights and boundaries against the
        drawings.
      </label>
      <div className="actions">
        <button
          disabled={!chosen.length || !(Number(height) > 0) || !note.trim()}
          onClick={() => apply(false)}
        >
          Apply height to selected rooms
        </button>
        <button
          disabled={
            !reviewed || !chosen.length || !(Number(height) > 0) || !note.trim()
          }
          onClick={() => apply(true)}
        >
          Fit and generate selected rooms
        </button>
      </div>
      <p className="fineprint">
        Only missing heights are filled. Generation fits nearby modeled wall
        faces within 12 inches and checks for gaps, collisions and overlaps.
        Rooms that fail stay unconfirmed; existing heights, confirmed rooms and
        manual members are preserved. No AI call is needed.
      </p>
      {message && <p role="status">{message}</p>}
      {problems.length > 0 && (
        <details open>
          <summary>
            Rooms still needing geometry review ({problems.length})
          </summary>
          {problems.map((p, i) => (
            <p className="fineprint" key={i}>
              {p}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
