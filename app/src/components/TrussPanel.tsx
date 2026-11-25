"use client";
import { useMemo, useState } from "react";
import type { BuildingModel } from "@/lib/model";
import {
  generateTrusses,
  fitZoneToWallFaces,
  mergeRoomZones,
  modelTrusses,
  memberLength,
  type Zone,
} from "@/lib/trusses";
import { removeElement, transformElement } from "@/lib/editing";
import TrussHeightReview from "./TrussHeightReview";
const FT = 304.8;
function Measure({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | null;
  onCommit: (v: number) => void;
}) {
  return (
    <label className="field">
      {label} · ft
      <input
        key={value ?? "unknown"}
        type="number"
        step="0.01"
        defaultValue={value === null ? "" : +(value / FT).toFixed(4)}
        placeholder={value === null ? "Enter source height" : undefined}
        onBlur={(e) => {
          const n = Number(e.target.value) * FT;
          if (e.target.value && Number.isFinite(n) && n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export default function TrussPanel({
  model,
  onChange,
  selected,
  onSelect,
  onError,
}: {
  model: BuildingModel;
  onChange: (m: BuildingModel) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onError: (s: string) => void;
}) {
  const [active, setActive] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const selectedZone = model.trussZones?.find(
    (z) =>
      z.id === selected ||
      generateTrusses(z).some(
        (m) => m.id === selected || m.trussId === selected,
      ),
  );
  const z =
    selectedZone ??
    model.trussZones?.find((z) => z.id === active) ??
    model.trussZones?.[0];
  const result = useMemo(() => {
    try {
      return modelTrusses(model);
    } catch (e) {
      return { members: [], zones: [], warnings: [String(e)] };
    }
  }, [model]);
  const editableMembers = useMemo(
    () =>
      (model.trussZones ?? []).flatMap((z) =>
        generateTrusses(z).map((m) => ({ ...m, zoneId: z.id })),
      ),
    [model],
  );
  const member = editableMembers.find((m) => m.id === selected);
  const group = editableMembers.filter((m) => m.trussId === selected);
  const apply = (f: () => BuildingModel) => {
    try {
      onChange(f());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const patch = (patch: Partial<Zone>) =>
    z &&
    apply(() => {
      const next = { ...z, ...patch };
      // Editing geometry of a frozen zone must transform its saved members, not lose them.
      if (
        z.members &&
        ["width", "depth", "center", "rotation", "ceilingHeight"].some(
          (k) => k in patch,
        )
      ) {
        return transformElement(model, z.id, {
          dx: next.center[0] - z.center[0],
          dz: next.center[1] - z.center[1],
          dy: next.ceilingHeight - z.ceilingHeight,
          rotation: ((next.rotation - z.rotation) * Math.PI) / 180,
          sx: next.width / z.width,
          sy: 1,
          sz: next.depth / z.depth,
        });
      }
      return {
        ...model,
        trussZones: model.trussZones!.map((v) => (v.id === z.id ? next : v)),
      };
    });
  return (
    <details className="panel truss-panel">
      <summary>
        <strong>Ceiling / floor trusses</strong> · {result.members.length}{" "}
        members ·{" "}
        {(result.members.reduce((s, m) => s + memberLength(m), 0) / FT).toFixed(
          2,
        )}{" "}
        LF
      </summary>
      <p>
        Review room heights, preview the layout, then add trusses to your model.
        Flat ceiling / floor assemblies only.
      </p>
      <p role="status">
        {result.zones.length
          ? `${result.zones.length} ${result.zones.length === 1 ? "room" : "rooms"} included in quantities.`
          : "Trusses have not been added yet. Start with the preview below."}
      </p>
      {z && (
        <TrussHeightReview
          key={`${model.name}:${z.levelId}:${model.trussZones?.[0]?.id}`}
          model={model}
          levelId={z.levelId}
          onChange={onChange}
          onError={onError}
          onEdit={(id) => {
            setActive(id);
            onSelect(id);
            setAdvanced(true);
          }}
        />
      )}
      {model.levels.length > 1 && (
        <label className="field">
          Review another floor
          <select
            value={z?.levelId ?? ""}
            onChange={(e) => {
              const room = model.trussZones?.find(
                (r) => r.levelId === e.target.value,
              );
              if (room) {
                setActive(room.id);
                onSelect(room.id);
              }
            }}
          >
            {model.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <details
        open={advanced}
        onToggle={(e) => setAdvanced(e.currentTarget.open)}
        className="truss-advanced"
      >
        <summary>
          Advanced editing — room boundaries, heights and individual members
        </summary>
        <button
          onClick={() => {
            const l = model.levels[0];
            if (!l) {
              onError("Add a floor first.");
              return;
            }
            const id = crypto.randomUUID();
            const center = l.outline.length
              ? [
                  l.outline.reduce((s, p) => s + p[0], 0) / l.outline.length,
                  l.outline.reduce((s, p) => s + p[1], 0) / l.outline.length,
                ]
              : [0, 0];
            onChange({
              ...model,
              trussZones: [
                ...(model.trussZones ?? []),
                {
                  id,
                  roomId: id,
                  label: "New room zone",
                  levelId: l.id,
                  center: center as [number, number],
                  width: 3048,
                  depth: 3657.6,
                  rotation: 0,
                  ceilingHeight: 0,
                  heightUnresolved: true,
                  kind: "ceiling",
                  upperLevelId: null,
                  confirmed: false,
                  evidence: [],
                  inferred: true,
                },
              ],
            });
            setActive(id);
            onSelect(id);
          }}
        >
          Add room zone
        </button>
        {!!model.trussZones?.length && (
          <select
            aria-label="Room zone"
            value={z?.id ?? ""}
            onChange={(e) => {
              setActive(e.target.value);
              onSelect(e.target.value);
            }}
          >
            {model.trussZones.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {v.heightUnresolved
                  ? " · height required"
                  : v.confirmed
                    ? ""
                    : " · needs review"}
              </option>
            ))}
          </select>
        )}
        {z && (
          <div className="truss-zone-fields">
            <label className="field">
              Room / zone name
              <input
                value={z.label}
                onChange={(e) => patch({ label: e.target.value })}
              />
            </label>
            <label className="field">
              Lower floor
              <select
                value={z.levelId}
                onChange={(e) =>
                  patch({ levelId: e.target.value, confirmed: false })
                }
              >
                {model.levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Assembly type
              <select
                value={z.kind}
                onChange={(e) =>
                  patch({
                    kind: e.target.value as Zone["kind"],
                    confirmed: false,
                  })
                }
              >
                <option value="ceiling">Ceiling</option>
                <option value="shared-floor-ceiling">
                  Shared floor / ceiling — count once
                </option>
                <option value="slab-on-grade">
                  Slab on grade — no trusses
                </option>
              </select>
            </label>
            {z.kind === "shared-floor-ceiling" && (
              <label className="field">
                Upper floor
                <select
                  value={z.upperLevelId ?? ""}
                  onChange={(e) =>
                    patch({
                      upperLevelId: e.target.value || null,
                      confirmed: false,
                    })
                  }
                >
                  <option value="">Choose upper floor</option>
                  {model.levels
                    .filter((l) => l.id !== z.levelId)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <Measure
              label="Center X"
              value={z.center[0]}
              onCommit={(v) => patch({ center: [v, z.center[1]] })}
            />
            <Measure
              label="Center Z"
              value={z.center[1]}
              onCommit={(v) => patch({ center: [z.center[0], v] })}
            />
            <Measure
              label="Room width"
              value={z.width}
              onCommit={(v) => patch({ width: v })}
            />
            <Measure
              label="Room depth"
              value={z.depth}
              onCommit={(v) => patch({ depth: v })}
            />
            <Measure
              label="Ceiling above lower floor"
              value={z.heightUnresolved ? null : z.ceilingHeight}
              onCommit={(v) =>
                patch({
                  ceilingHeight: v,
                  heightUnresolved: false,
                  heightReview: {
                    basis: "reviewer-entered",
                    note: "Ceiling height entered individually by reviewer.",
                  },
                  confirmed: false,
                })
              }
            />
            <label className="field">
              Room orientation · degrees
              <input
                type="number"
                value={z.rotation}
                onChange={(e) => patch({ rotation: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              Span direction
              <select
                value={z.spanAxis ?? "shorter"}
                onChange={(e) =>
                  patch({
                    spanAxis: e.target.value as Zone["spanAxis"],
                    members: undefined,
                    confirmed: false,
                  })
                }
                disabled={!!z.members}
              >
                <option value="shorter">Shorter room dimension</option>
                <option value="width">Along room width</option>
                <option value="depth">Along room depth</option>
              </select>
            </label>
            <button
              onClick={() =>
                apply(() => ({
                  ...model,
                  trussZones: model.trussZones!.map((v) =>
                    v.id === z.id ? fitZoneToWallFaces(model, z) : v,
                  ),
                }))
              }
            >
              Fit span to nearby wall faces
            </button>
            <p className="fineprint">
              Fit adjusts this room to modeled wall faces within 12 inches;
              verify those walls against the drawing. Open seams cannot support
              a truss. Both ends must meet walls at ceiling height before
              quantities are included. This checks geometry, not structural
              capacity.
            </p>
            {(model.trussZones?.length ?? 0) > 1 && (
              <div>
                <label className="field">
                  Join across an open seam
                  <select
                    value={mergeTarget}
                    onChange={(e) => setMergeTarget(e.target.value)}
                  >
                    <option value="">Choose adjacent zone…</option>
                    {model
                      .trussZones!.filter((v) => v.id !== z.id)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={!mergeTarget || mergeTarget === z.id}
                  onClick={() =>
                    apply(() => mergeRoomZones(model, z.id, mergeTarget))
                  }
                >
                  Merge into one continuous room
                </button>
              </div>
            )}
            <label>
              <input
                type="checkbox"
                checked={z.confirmed}
                disabled={z.heightUnresolved}
                onChange={(e) => patch({ confirmed: e.target.checked })}
              />{" "}
              Room boundaries and ceiling height checked
            </label>
            <p className="fineprint">
              New manual zones require a source-backed ceiling height. For
              L-shaped rooms, add separate non-overlapping rectangles only when
              every truss spans between real opposing walls. Expand a room
              across an open seam instead of treating it as support.{" "}
              {z.members
                ? "Manual member edits are saved; changing the zone carries those edits."
                : "Changing room dimensions rebuilds the standard layout."}
            </p>
            {z.evidence.map((e, i) => (
              <p className="fineprint" key={i}>
                Source: {e.sheet} · PDF page {e.page} · {e.note}
              </p>
            ))}
            {z.heightReview && (
              <p className="fineprint">
                Height review: {z.heightReview.note} (
                {z.heightReview.basis === "floor-model"
                  ? "floor-model value applied by reviewer"
                  : "reviewer-entered value"}
                )
              </p>
            )}
            <div className="actions">
              <button onClick={() => onSelect(z.id)}>Select whole zone</button>
              {z.members && (
                <button
                  onClick={() => {
                    patch({ members: undefined });
                    onSelect(z.id);
                  }}
                >
                  Rebuild standard layout (replaces member edits)
                </button>
              )}
              <button
                onClick={() => {
                  apply(() => removeElement(model, z.id));
                  onSelect(null);
                }}
              >
                Delete zone
              </button>
            </div>
          </div>
        )}
        {z && (
          <label className="field">
            Select truss or member
            <select
              aria-label="Select truss or member"
              value={member?.id ?? (group.length ? selected! : "")}
              onChange={(e) => onSelect(e.target.value || null)}
            >
              <option value="">Choose a truss or member…</option>
              {[
                ...new Set(
                  editableMembers
                    .filter((m) => m.zoneId === z.id)
                    .map((m) => m.trussId),
                ),
              ].map((id, i) => (
                <optgroup key={id} label={`Truss ${i + 1}`}>
                  <option value={id}>Whole truss {i + 1}</option>
                  {editableMembers
                    .filter((m) => m.trussId === id)
                    .map((m, k) => (
                      <option key={m.id} value={m.id}>
                        {i + 1}.{k + 1} {m.role}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
      </details>
      <details>
        <summary>Technical rules and validation details</summary>
        <p className="fineprint">
          Flat trusses: 16 in. depth, 3½ in. width, 24 in. spacing. Shared floor
          / ceiling counted once; slab-on-grade and pitched roofs excluded.
          Quantities only; pricing pending.
        </p>
        {result.warnings.map((w, i) => (
          <p key={i} className="fineprint" role="status">
            {w}
          </p>
        ))}
      </details>
    </details>
  );
}

export function TrussSelection({
  model,
  selected,
  onChange,
  onSelect,
}: {
  model: BuildingModel;
  selected: string;
  onChange: (m: BuildingModel) => void;
  onSelect: (id: string | null) => void;
}) {
  const members = (model.trussZones ?? []).flatMap((z) =>
    generateTrusses(z).map((m) => ({ ...m, zoneId: z.id })),
  );
  const member = members.find((m) => m.id === selected),
    group = members.filter((m) => m.trussId === selected);
  const zone = model.trussZones?.find((z) => z.id === selected);
  if (!member && !group.length && !zone) return null;
  const move = { dx: 0, dy: 0, dz: 0, rotation: 0, sx: 1, sy: 1, sz: 1 };
  return (
    <div className="framing-note">
      <strong>
        {member
          ? `Truss ${member.role}`
          : zone
            ? zone.label
            : "Selected truss assembly"}
      </strong>
      {member && (
        <Measure
          label="Member length"
          value={memberLength(member)}
          onCommit={(v) => {
            if (v > 0)
              onChange(
                transformElement(model, member.id, {
                  ...move,
                  sx: v / memberLength(member),
                }),
              );
          }}
        />
      )}
      <p>
        Use the handles to move, rotate or resize. Changes are saved
        independently and retained on reload.
      </p>
      {member && (
        <details>
          <summary>Member endpoints</summary>
          {(["start", "end"] as const).flatMap((end) =>
            member[end].map((v, i) => (
              <Measure
                key={end + i}
                label={`${end} ${["X", "elevation", "Z"][i]}`}
                value={v}
                onCommit={(value) => {
                  const zones = model.trussZones!.map((z) =>
                    z.id !== member.zoneId
                      ? z
                      : {
                          ...z,
                          members: generateTrusses(z).map((m) =>
                            m.id !== member.id
                              ? m
                              : {
                                  ...m,
                                  [end]: m[end].map((n, k) =>
                                    k === i ? value : n,
                                  ),
                                },
                          ),
                        },
                  );
                  onChange({ ...model, trussZones: zones });
                }}
              />
            )),
          )}
        </details>
      )}
      <button
        onClick={() => {
          onChange(removeElement(model, selected));
          onSelect(null);
        }}
      >
        Delete selected {member ? "member" : zone ? "zone" : "truss"}
      </button>
    </div>
  );
}
