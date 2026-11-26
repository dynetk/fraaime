"use client";
import { useMemo, useState } from "react";
import type { BuildingModel } from "@/lib/model";
import { FURNITURE, type Furniture, type FurnitureKind } from "@/lib/furniture";
import {
  canStand,
  findSpawn,
  floorBounds,
  furnitureRect,
  navigationFor,
  placementError,
  rectCorners,
  type Position,
} from "@/lib/walkthrough";
import type { TourLighting } from "@/lib/walkthrough-scene";
import WalkthroughCanvas, { type TourPose } from "./WalkthroughCanvas";

export default function Walkthrough({
  model,
  onChange,
  onExit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  model: BuildingModel;
  onChange: (model: BuildingModel) => void;
  onExit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const [chosenFloor, setFloor] = useState(""),
    [lighting, setLighting] = useState<TourLighting>("day"),
    [lights, setLights] = useState(true),
    [ceiling, setCeiling] = useState(true);
  const [pending, setPending] = useState<FurnitureKind | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [message, setMessage] = useState("");
  const [pose, setPose] = useState<TourPose | null>(null),
    [cursor, setCursor] = useState<Position | null>(null),
    [target, setTarget] = useState<{
      position: Position;
      sequence: number;
    } | null>(null);
  const level =
    model.levels.find((l) => l.id === chosenFloor) ??
    model.levels.find((l) => l.outline.length >= 3) ??
    model.levels[0];
  const nav = useMemo(
    () => (level ? navigationFor(model, level.id) : null),
    [model, level],
  );
  const spawn = useMemo(() => (nav ? findSpawn(nav) : null), [nav]);
  const items = (model.furniture ?? []).filter((f) => f.levelId === level?.id),
    item = items.find((f) => f.id === selected);
  const bounds = level
    ? floorBounds(level)
    : { minX: 0, minZ: 0, width: 1000, depth: 1000 };
  const pad = Math.max(bounds.width, bounds.depth) * 0.04;
  const changeFurniture = (f: Furniture) => {
    const error = placementError(model, f);
    if (error) {
      setMessage(error);
      return false;
    }
    const furniture = (model.furniture ?? []).filter(
      (other) => other.id !== f.id,
    );
    if (furniture.length >= 200) {
      setMessage("This model already has the maximum of 200 furniture items.");
      return false;
    }
    const next = { ...model, furniture: [...furniture, f] },
      nextNav = navigationFor(next, f.levelId);
    if (!nextNav || !findSpawn(nextNav)) {
      setMessage("Leave enough clear floor space for someone to stand.");
      return false;
    }
    onChange(next);
    setMessage(
      `${FURNITURE[f.kind].label} placed. Save changes to keep your layout.`,
    );
    return true;
  };
  const usePoint = (p: Position) => {
    if (!nav) return;
    setCursor(p);
    if (pending) {
      const f: Furniture = {
        id: crypto.randomUUID(),
        kind: pending,
        levelId: nav.level.id,
        center: p,
        rotation: 0,
      };
      if (changeFurniture(f)) {
        setPending(null);
        setSelected(f.id);
      }
    } else if (item) changeFurniture({ ...item, center: p });
    else if (canStand(nav, p)) {
      setTarget((t) => ({ position: p, sequence: (t?.sequence ?? 0) + 1 }));
      setMessage("");
    } else
      setMessage(
        "Choose clear floor space away from walls, furniture, and floor openings.",
      );
  };
  return (
    <section className="tour" aria-label="House walkthrough">
      <div className="tour-toolbar">
        <div>
          <div className="eyebrow">EXPERIENCE YOUR SPACE</div>
          <h2>Walkthrough</h2>
        </div>
        <label>
          Floor{" "}
          <select
            aria-label="Walkthrough floor"
            value={level?.id ?? ""}
            onChange={(e) => {
              setFloor(e.target.value);
              setSelected(null);
              setPending(null);
              setPose(null);
              setTarget(null);
              setCursor(null);
              setMessage("");
            }}
          >
            {model.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <div className="toolgroup" role="group" aria-label="Time of day">
          {(["day", "sunset", "night"] as const).map((p) => (
            <button
              key={p}
              aria-pressed={lighting === p}
              className={lighting === p ? "active" : ""}
              onClick={() => setLighting(p)}
            >
              {p === "day" ? "Day" : p === "sunset" ? "Sunset" : "Night"}
            </button>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={lights}
            onChange={(e) => setLights(e.target.checked)}
          />{" "}
          Interior lights
        </label>
        <label>
          <input
            type="checkbox"
            checked={ceiling}
            onChange={(e) => setCeiling(e.target.checked)}
          />{" "}
          Ceiling preview
        </label>
        <button onClick={onExit}>Exit walkthrough</button>
      </div>
      {!nav || !spawn ? (
        <div className="tour-empty">
          <h3>No walkable floor yet</h3>
          <p>
            {!level
              ? "Generate or open a house model first."
              : "This floor needs a complete outline and clear standing space at least 6 feet high. Choose another floor or review the model in the editor."}
          </p>
        </div>
      ) : (
        <div className="tour-layout">
          <div>
            <WalkthroughCanvas
              key={level.id}
              model={model}
              nav={nav}
              ceiling={ceiling}
              lighting={lighting}
              interiorLights={lights}
              target={target}
              onPose={setPose}
            />
            <p className="tour-help">
              Click the view, then use W A S D to walk. Drag to look, or use
              arrow keys to turn. Mouse look captures the pointer; Esc releases
              it. Use the controls below the view on touch screens.
            </p>
          </div>
          <aside className="tour-sidebar">
            <div className="tour-map-heading">
              <h3>
                {pending
                  ? `Place ${FURNITURE[pending].label.toLowerCase()}`
                  : item
                    ? `Move ${FURNITURE[item.kind].label.toLowerCase()}`
                    : "Explore the floor"}
              </h3>
              <button
                onClick={() => {
                  setPending(null);
                  setSelected(null);
                  setTarget((t) => ({
                    position: spawn,
                    sequence: (t?.sequence ?? 0) + 1,
                  }));
                  setMessage("");
                }}
              >
                Reset position
              </button>
            </div>
            <p>
              {pending || item
                ? "Click a clear spot on the map to place the item."
                : "Click clear floor space to stand there. Use the floor selector to move between stories."}
            </p>
            <svg
              className="tour-map"
              viewBox={`${bounds.minX - pad} ${bounds.minZ - pad} ${bounds.width + pad * 2} ${bounds.depth + pad * 2}`}
              role="application"
              aria-label="Walkthrough floor map. Arrow keys move the target; Enter places furniture or moves you there."
              tabIndex={0}
              onPointerDown={(e) => {
                const svg = e.currentTarget,
                  matrix = svg.getScreenCTM();
                if (!matrix) return;
                const p = svg.createSVGPoint();
                p.x = e.clientX;
                p.y = e.clientY;
                const local = p.matrixTransform(matrix.inverse());
                usePoint([local.x, local.y]);
              }}
              onKeyDown={(e) => {
                const p = cursor ?? pose?.position ?? spawn;
                const directions: Record<string, Position> = {
                  ArrowLeft: [-250, 0],
                  ArrowRight: [250, 0],
                  ArrowUp: [0, -250],
                  ArrowDown: [0, 250],
                };
                if (directions[e.key]) {
                  e.preventDefault();
                  const delta = directions[e.key];
                  setCursor([
                    Math.max(
                      bounds.minX,
                      Math.min(bounds.minX + bounds.width, p[0] + delta[0]),
                    ),
                    Math.max(
                      bounds.minZ,
                      Math.min(bounds.minZ + bounds.depth, p[1] + delta[1]),
                    ),
                  ]);
                } else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  usePoint(p);
                }
              }}
            >
              <path
                d={[level.outline, ...level.voids]
                  .map((poly) =>
                    poly.length
                      ? "M" + poly.map((p) => p.join(",")).join(" L") + " Z"
                      : "",
                  )
                  .join(" ")}
                fill="#f2ede3"
                fillRule="evenodd"
                stroke="#bdb6a8"
                strokeWidth={50}
              />
              {model.walls
                .filter((w) => w.levelId === level.id)
                .map((w) => (
                  <line
                    key={w.id}
                    x1={w.start[0]}
                    y1={w.start[1]}
                    x2={w.end[0]}
                    y2={w.end[1]}
                    stroke="#514e46"
                    strokeWidth={w.thickness}
                  />
                ))}
              {model.openings.map((o) => {
                const w = model.walls.find(
                  (w) => w.id === o.wallId && w.levelId === level.id,
                );
                if (!w) return null;
                const len = Math.hypot(
                  w.end[0] - w.start[0],
                  w.end[1] - w.start[1],
                );
                if (!len) return null;
                const dx = (w.end[0] - w.start[0]) / len,
                  dz = (w.end[1] - w.start[1]) / len;
                return (
                  <line
                    key={o.id}
                    x1={w.start[0] + dx * o.offset}
                    y1={w.start[1] + dz * o.offset}
                    x2={w.start[0] + dx * (o.offset + o.width)}
                    y2={w.start[1] + dz * (o.offset + o.width)}
                    stroke={o.kind === "window" ? "#81b9cf" : "#f2ede3"}
                    strokeWidth={w.thickness + 10}
                  />
                );
              })}
              {items.map((f) => (
                <polygon
                  key={f.id}
                  points={rectCorners(furnitureRect(f))
                    .map((p) => p.join(","))
                    .join(" ")}
                  fill={FURNITURE[f.kind].color}
                  stroke={selected === f.id ? "#db791f" : "#fff"}
                  strokeWidth={selected === f.id ? 100 : 30}
                  onPointerDown={(e) => {
                    if (!pending) {
                      e.stopPropagation();
                      setSelected(f.id);
                      setMessage("");
                    }
                  }}
                >
                  <title>{FURNITURE[f.kind].label}</title>
                </polygon>
              ))}
              {cursor && (
                <g stroke="#a15e23" strokeWidth={50}>
                  <path
                    d={`M${cursor[0] - 180},${cursor[1]} h360 M${cursor[0]},${cursor[1] - 180} v360`}
                  />
                </g>
              )}
              <g
                transform={`translate(${(pose?.position ?? spawn).join(" ")}) rotate(${(-(pose?.yaw ?? 0) * 180) / Math.PI})`}
              >
                <circle
                  r={190}
                  fill="#204e70"
                  stroke="white"
                  strokeWidth={35}
                />
                <path d="M-140,-210 L0,-430 L140,-210" fill="#204e70" />
              </g>
            </svg>
            {(pending || item) && (
              <button
                className="quiet"
                onClick={() => {
                  setPending(null);
                  setSelected(null);
                  setMessage("");
                }}
              >
                Done placing · explore map
              </button>
            )}
            <h3>Add furniture</h3>
            <div className="tour-catalog">
              {(Object.keys(FURNITURE) as FurnitureKind[]).map((kind) => (
                <button
                  key={kind}
                  aria-pressed={pending === kind}
                  className={pending === kind ? "active" : ""}
                  onClick={() => {
                    setPending(kind);
                    setSelected(null);
                    setMessage("");
                  }}
                >
                  <strong>{FURNITURE[kind].label}</strong>
                  <span>
                    {(FURNITURE[kind].width / 304.8).toFixed(1)}′ ×{" "}
                    {(FURNITURE[kind].depth / 304.8).toFixed(1)}′
                  </span>
                </button>
              ))}
            </div>
            {items.length > 0 && (
              <label className="tour-item-select">
                Placed furniture{" "}
                <select
                  aria-label="Placed furniture"
                  value={item?.id ?? ""}
                  onChange={(e) => {
                    setSelected(e.target.value || null);
                    setPending(null);
                  }}
                >
                  <option value="">Choose an item</option>
                  {items.map((f, i) => (
                    <option key={f.id} value={f.id}>
                      {FURNITURE[f.kind].label} {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {item && (
              <div className="tour-item-actions">
                <button
                  onClick={() =>
                    changeFurniture({
                      ...item,
                      rotation: (item.rotation + 45) % 360,
                    })
                  }
                >
                  Rotate 45°
                </button>
                <button
                  onClick={() => {
                    onChange({
                      ...model,
                      furniture: (model.furniture ?? []).filter(
                        (f) => f.id !== item.id,
                      ),
                    });
                    setSelected(null);
                    setMessage(
                      "Item removed. Save changes to keep your layout.",
                    );
                  }}
                >
                  Remove item
                </button>
              </div>
            )}
            <div className="tour-item-actions">
              <button disabled={!canUndo} onClick={onUndo}>
                Undo
              </button>
              <button disabled={!canRedo} onClick={onRedo}>
                Redo
              </button>
            </div>
            {message && (
              <p className="tour-message" role="status">
                {message}
              </p>
            )}
          </aside>
        </div>
      )}
      <p className="tour-disclaimer">
        Concept preview of the current model. Furniture, finishes, flat
        ceilings, outdoor scenery, and lighting are illustrative. Day/night
        presets do not predict sunlight at the property. Doorways stay open; use
        the map for disconnected rooms. Save changes to keep furniture with this
        revision.
      </p>
    </section>
  );
}
