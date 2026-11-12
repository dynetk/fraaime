"use client";
import { useMemo } from "react";
import type { BuildingModel } from "@/lib/model";
import { panelConnections } from "@/lib/panel-connections";

export default function PanelConnections({
  model,
  onChange,
  onSelect,
}: {
  model: BuildingModel;
  onChange: (model: BuildingModel) => void;
  onSelect: (id: string) => void;
}) {
  const { connections } = useMemo(() => panelConnections(model), [model]);
  const walls = new Map(model.walls.map((w) => [w.id, w]));
  return (
    <details className="framing-note panel-connections">
      <summary>
        Panel connections · {connections.length} junctions ·{" "}
        {connections.filter((c) => c.messages.length).length} to review
      </summary>
      <p>
        WP-1 continues through the junction; WP-2 butts against its framing
        face. Wall locations and floor outlines stay fixed. Confirm wall-to-wall
        dimensions against the drawing. Select a wall to set its stud-web depth.
      </p>
      {!connections.length && (
        <p>
          No L or T junctions detected. Walls must meet at their centerlines or
          framing faces.
        </p>
      )}
      <ul>
        {connections.map((c) => (
          <li key={c.id}>
            <strong>
              {c.kind === "tee"
                ? "T connection"
                : c.kind === "corner"
                  ? "L corner"
                  : "Junction to review"}
            </strong>
            {" · "}
            {c.applied ? "Panel layout generated" : "Needs a connection layout"}
            <div>
              <button onClick={() => onSelect(c.throughWallId)}>
                WP-1: {walls.get(c.throughWallId)?.label}
              </button>
              {" + "}
              <button onClick={() => onSelect(c.branchWallId)}>
                WP-2: {walls.get(c.branchWallId)?.label}
              </button>
            </div>
            <p>
              X = {(c.webDepthMm / 25.4).toFixed(3)} in.
              {" · "}
              {c.webDepthBasis}
            </p>
            {c.kind === "corner" && (
              <label>
                Continuous panel (WP-1){" "}
                <select
                  aria-label={`Continuous panel at ${walls.get(c.throughWallId)?.label} / ${walls.get(c.branchWallId)?.label}`}
                  value={c.throughWallId}
                  onChange={(e) =>
                    onChange({
                      ...model,
                      panelConnectionChoices: [
                        ...(model.panelConnectionChoices ?? []).filter(
                          (x) => x.connectionId !== c.id,
                        ),
                        { connectionId: c.id, throughWallId: e.target.value },
                      ],
                    })
                  }
                >
                  {[c.throughWallId, c.branchWallId].map((id) => (
                    <option key={id} value={id}>
                      {walls.get(id)?.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {c.messages.map((message) => (
              <p className="fineprint" key={message}>
                {message}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </details>
  );
}
