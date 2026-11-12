import { length, wallTop, type BuildingModel, type WallData } from "./model";
import { MEMBER_FACE } from "./framing-constants";

const EPS = 1; // millimetres: numerical coincidence, not a drawing snap distance.
type Point = number[];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const direction = (w: WallData) => {
  const n = length(w);
  return [(w.end[0] - w.start[0]) / n, (w.end[1] - w.start[1]) / n];
};
export const panelWebDepth = (w: WallData) =>
  w.framingWebDepthMm ?? w.thickness;
export const connectionId = (a: string, b: string) =>
  JSON.stringify([a, b].sort());
export type PanelLayout = {
  wall: WallData;
  startOffset: number;
  endOffset: number;
  connectionStuds: number[]; // centers measured from the ORIGINAL wall start
};
export type PanelConnection = {
  id: string;
  kind: "corner" | "tee" | "unsupported";
  throughWallId: string;
  branchWallId: string;
  webDepthMm: number;
  webDepthBasis: "modeled wall thickness" | "wall override";
  applied: boolean;
  messages: string[];
};

/** Derived framing bounds only: architectural walls, openings and floor areas
 * remain untouched. WP-1 is continuous; WP-2 ends at its framing face. */
export function panelConnections(model: BuildingModel) {
  const panels = new Map<string, PanelLayout>(
    model.walls.map((w) => [
      w.id,
      {
        wall: w,
        startOffset: 0,
        endOffset: length(w),
        connectionStuds: [],
      },
    ]),
  );
  const connections: PanelConnection[] = [];
  const custom = new Set(model.framingAssemblies?.map((a) => a.wallId));
  const walls = [...model.walls]
    .filter((w) => length(w) > 2 * MEMBER_FACE)
    .sort((a, b) => a.id.localeCompare(b.id));
  const endpoint = (t: number, span: number, otherDepth: number) => {
    const start = Math.abs(t),
      end = Math.abs(t - span);
    const d = Math.min(start, end);
    return d <= EPS || Math.abs(d - otherDepth / 2) <= EPS
      ? start <= end
        ? "start"
        : "end"
      : null;
  };
  for (let i = 0; i < walls.length; i++)
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i],
        b = walls[j];
      if (a.levelId !== b.levelId) continue;
      // Cheap broad phase before intersecting infinite centerlines.
      const reach = Math.max(panelWebDepth(a), panelWebDepth(b)) / 2 + EPS;
      if (
        [0, 1].some(
          (k) =>
            Math.max(a.start[k], a.end[k]) + reach <
              Math.min(b.start[k], b.end[k]) ||
            Math.max(b.start[k], b.end[k]) + reach <
              Math.min(a.start[k], a.end[k]),
        )
      )
        continue;
      const da = direction(a),
        db = direction(b),
        den = cross(da, db);
      if (Math.abs(den) < 1e-6) continue;
      const delta = [b.start[0] - a.start[0], b.start[1] - a.start[1]];
      const ta = cross(delta, db) / den,
        tb = cross(delta, da) / den;
      const ea = endpoint(ta, length(a), panelWebDepth(b));
      const eb = endpoint(tb, length(b), panelWebDepth(a));
      if (
        ta < -panelWebDepth(b) / 2 - EPS ||
        ta > length(a) + panelWebDepth(b) / 2 + EPS ||
        tb < -panelWebDepth(a) / 2 - EPS ||
        tb > length(b) + panelWebDepth(a) / 2 + EPS
      )
        continue;
      const id = connectionId(a.id, b.id);
      const corner = !!ea && !!eb;
      const perpendicular = Math.abs(da[0] * db[0] + da[1] * db[1]) <= 0.001;
      // Stable automatic corner priority: exterior, then longer panel, then ID.
      const preferred = model.panelConnectionChoices?.find(
        (c) => c.connectionId === id,
      )?.throughWallId;
      const rank = (w: WallData) => (w.role === "exterior" ? 1 : 0);
      const host =
        !ea && eb
          ? a
          : !eb && ea
            ? b
            : preferred === a.id
              ? a
              : preferred === b.id
                ? b
                : rank(a) !== rank(b)
                  ? rank(a) > rank(b)
                    ? a
                    : b
                  : length(a) !== length(b)
                    ? length(a) > length(b)
                      ? a
                      : b
                    : a;
      const branch = host.id === a.id ? b : a;
      const ht = host.id === a.id ? ta : tb,
        bt = host.id === a.id ? tb : ta;
      const he = host.id === a.id ? ea : eb,
        be = host.id === a.id ? eb : ea;
      const row: PanelConnection = {
        id,
        kind:
          perpendicular && (ea || eb)
            ? corner
              ? "corner"
              : "tee"
            : "unsupported",
        throughWallId: host.id,
        branchWallId: branch.id,
        webDepthMm: panelWebDepth(branch),
        webDepthBasis:
          branch.framingWebDepthMm === undefined
            ? "modeled wall thickness"
            : "wall override",
        applied: false,
        messages: [],
      };
      connections.push(row);
      if (row.kind === "unsupported" || !be) {
        row.messages.push(
          "Angled or crossing junction: the supplied standard covers right-angle L and T joints only.",
        );
        continue;
      }
      if (corner) {
        const junction = [a.start[0] + da[0] * ta, a.start[1] + da[1] * ta];
        const splitJunction = walls.some((w) => {
          if (w.id === a.id || w.id === b.id || w.levelId !== a.levelId)
            return false;
          const d = direction(w),
            delta = [junction[0] - w.start[0], junction[1] - w.start[1]];
          if (Math.abs(cross(d, delta)) > EPS) return false;
          const parallelA = Math.abs(cross(d, da)) < 0.001;
          const parallelB = Math.abs(cross(d, db)) < 0.001;
          return (
            (parallelA || parallelB) &&
            !!endpoint(
              delta[0] * d[0] + delta[1] * d[1],
              length(w),
              panelWebDepth(parallelA ? b : a),
            )
          );
        });
        if (splitJunction) {
          row.kind = "unsupported";
          row.messages.push(
            "Multiple wall endpoints meet here. Consolidate a split T through-wall into one continuous source wall before generating its two-panel connection.",
          );
          continue;
        }
      }
      if (row.webDepthMm < 2 * MEMBER_FACE) {
        row.messages.push(
          "The web depth is too narrow for this schematic pair of connection studs. Review the member profile.",
        );
        continue;
      }
      const hp = panels.get(host.id)!,
        bp = panels.get(branch.id)!;
      const hs =
        corner && he === "start" ? ht - row.webDepthMm / 2 : hp.startOffset;
      const hz =
        corner && he === "end" ? ht + row.webDepthMm / 2 : hp.endOffset;
      const bs = be === "start" ? bt + panelWebDepth(host) / 2 : bp.startOffset;
      const bz = be === "end" ? bt - panelWebDepth(host) / 2 : bp.endOffset;
      const targets = [
        ht - row.webDepthMm / 2 + MEMBER_FACE / 2,
        ht + row.webDepthMm / 2 - MEMBER_FACE / 2,
      ];
      const bounds = [
        [host, hs, hz],
        [branch, bs, bz],
      ] as const;
      if (
        bounds.some(
          ([w, start, end]) =>
            end - start < 2 * MEMBER_FACE ||
            panels
              .get(w.id)!
              .connectionStuds.some(
                (x) =>
                  x - MEMBER_FACE / 2 < start - EPS ||
                  x + MEMBER_FACE / 2 > end + EPS,
              ) ||
            model.openings.some(
              (o) =>
                o.wallId === w.id &&
                (o.offset < start - EPS || o.offset + o.width > end + EPS),
            ),
        )
      ) {
        row.messages.push(
          "Panel separation would cut into an opening or leave too little panel length. Review the wall/door locations.",
        );
        continue;
      }
      const holes = model.openings.filter((o) => o.wallId === host.id);
      const jambs = holes.flatMap((o) => [
        o.offset - MEMBER_FACE / 2,
        o.offset + o.width + MEMBER_FACE / 2,
      ]);
      const anchors = [
        hs + MEMBER_FACE / 2,
        hz - MEMBER_FACE / 2,
        ...hp.connectionStuds,
        ...jambs,
      ];
      if (
        targets.some(
          (x) =>
            x - MEMBER_FACE / 2 < hs - EPS ||
            x + MEMBER_FACE / 2 > hz + EPS ||
            holes.some(
              (o) =>
                x + MEMBER_FACE / 2 > o.offset + EPS &&
                x - MEMBER_FACE / 2 < o.offset + o.width - EPS,
            ) ||
            anchors.some(
              (p) =>
                Math.abs(p - x) > EPS && Math.abs(p - x) < MEMBER_FACE - EPS,
            ),
        )
      ) {
        row.messages.push(
          "Connection studs conflict with an opening, panel end or another connection. Review this junction.",
        );
        continue;
      }
      hp.startOffset = hs;
      hp.endOffset = hz;
      bp.startOffset = bs;
      bp.endOffset = bz;
      for (const x of targets)
        if (!hp.connectionStuds.some((p) => Math.abs(p - x) <= EPS))
          hp.connectionStuds.push(x);
      row.applied = true;
      if (custom.has(host.id) || custom.has(branch.id))
        row.messages.push(
          "Custom members are preserved. Check their connection alignment, or reset the affected panels to regenerate them.",
        );
    }
  return { panels, connections };
}

/** Convert derived bounds to a temporary wall, retaining the source height profile. */
export function framingPanel(p: PanelLayout): WallData {
  const w = p.wall,
    d = direction(w),
    n = length(w),
    span = p.endOffset - p.startOffset;
  const at = (x: number) => wallTop(w, Math.max(0, Math.min(n, x)));
  const profile: [number, number][] = [[0, at(p.startOffset)]];
  for (const [f, h] of w.topProfile ?? []) {
    const x = f * n;
    if (x > p.startOffset && x < p.endOffset)
      profile.push([(x - p.startOffset) / span, h]);
  }
  profile.push([1, at(p.endOffset)]);
  return {
    ...w,
    start: w.start.map((v, i) => v + d[i] * p.startOffset),
    end: w.start.map((v, i) => v + d[i] * p.endOffset),
    thickness: panelWebDepth(w),
    ...(w.topProfile ? { topProfile: profile } : {}),
  };
}
