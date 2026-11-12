import { wallArea as profiledWallArea } from "./model";
import { length, minimumWallTop, type BuildingModel } from "./model";
import {
  modelWallFraming,
  polygonFraming,
  roofHeight,
  FRAMING_TEMPLATE_VERSION,
  BOX_HEADER_WEB,
} from "./framing";
import { panelConnections } from "./panel-connections";
import {
  EstimateSettingsSchema,
  MOCK_ESTIMATE_SETTINGS,
  type EstimateSettings,
} from "./estimate-settings";
const FT = 304.8,
  SF = FT * FT;
const round = (v: number) =>
  Math.round((v + Number.EPSILON * Math.max(1, Math.abs(v))) * 100) / 100;
export const dollars = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    v,
  );
type Kind = "stud" | "track" | "header" | "joist";
export type Quantity = {
  role?: string;
  elementId: string;
  label: string;
  source:
    | "wall preview"
    | "custom wall"
    | "manual member"
    | "floor preview"
    | "roof preview";
  kind: Kind;
  lengthFt: number;
};
export type EstimateLine = {
  id: string;
  label: string;
  category: "material" | "labor";
  quantity: number;
  billableQuantity: number;
  unit: "LF" | "SF";
  rate: number;
  amount: number;
};
export const ESTIMATE_EXCLUSIONS = [
  "Fictional prices and illustrative framing quantities; not a supplier quote, engineered takeoff, or cost to build the whole project.",
  "No specified steel grade/gauge, stock-length optimization, connectors, fasteners, bracing, sheathing, foundations, roof covering, doors/windows, finishes, MEP, engineering, permits, or tax.",
  "Opening framing uses modeled dimensions without an invented unit-to-rough-opening allowance. Per the pilot assumption, door/window unit dimensions are used as provisional framing openings with no added manufacturer clearance. Box headers use two schematic 6-inch C webs and two U tracks matching wall depth; steel gauge, flanges, bearing and connection design are unresolved.",
  "Opening products and unplaced schedule rows are excluded. Openings only affect the framing preview around them.",
  "Floor/roof perimeter pieces use the same mock joist rate. Roof decks are excluded from automatic roof framing. Manual framing members are always included; generic boxes are unpriced.",
  "Wall labor uses gross wall area, without subtracting openings. Floor/roof labor uses net modeled area. Standalone manual-member installation is not quantified separately.",
];
function area2(points: number[][]): number {
  return (
    Math.abs(
      points.reduce((s, p, i) => {
        const q = points[(i + 1) % points.length];
        return s + p[0] * q[1] - q[0] * p[1];
      }, 0),
    ) / 2
  );
}
function area3(points: number[][]): number {
  const n = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return Math.hypot(...n) / 2;
}
export function buildEstimate(
  model: BuildingModel,
  input: EstimateSettings = model.estimate ?? MOCK_ESTIMATE_SETTINGS,
) {
  const settings = EstimateSettingsSchema.parse(input),
    quantities: Quantity[] = [];
  // Lorenzo: wall studs, tracks and header C members share one LF price.
  settings.rates.track = settings.rates.stud;
  settings.rates.header = settings.rates.stud;
  const add = (
    elementId: string,
    label: string,
    source: Quantity["source"],
    kind: Kind,
    mm: number,
    role?: string,
  ) => {
    if (!Number.isFinite(mm) || mm <= 0) return;
    if (quantities.length >= 50000)
      throw new Error(
        "This model exceeds the 50,000-member demo-estimate limit. Estimate a smaller model.",
      );
    quantities.push({
      elementId,
      label,
      source,
      kind,
      lengthFt: mm / FT,
      ...(role ? { role } : {}),
    });
  };
  const customWalls = new Map(
    (model.framingAssemblies ?? []).map((a) => [a.wallId, a]),
  );
  const customMembers = new Set(
    (model.framingAssemblies ?? []).flatMap((a) => a.componentIds),
  );
  const components = new Map(model.components.map((c) => [c.id, c]));
  const panelFrames = modelWallFraming(model, settings.spacingMm);
  const connections = panelConnections(model).connections;
  let wallArea = 0,
    floorArea = 0,
    roofArea = 0;
  for (const wall of model.walls) {
    const assembly = customWalls.get(wall.id);
    if (assembly) {
      if (
        assembly.componentIds.some((id) => {
          const c = components.get(id);
          return c && c.kind !== "box";
        })
      )
        wallArea += profiledWallArea(wall) / SF;
      continue;
    }
    const pieces = panelFrames.get(wall.id) ?? [];
    if (pieces.length) wallArea += profiledWallArea(wall) / SF;
    for (const p of pieces)
      add(
        wall.id,
        wall.label,
        "wall preview",
        p.kind,
        p.kind === "stud" ? p.height : p.width,
        p.role,
      );
  }
  for (const c of model.components) {
    if (c.kind === "box") continue;
    add(
      c.id,
      c.label,
      customMembers.has(c.id) ? "custom wall" : "manual member",
      c.kind,
      c.kind === "stud" ? c.height : c.length,
      c.framingRole,
    );
  }
  if (settings.includeFloorFraming)
    for (const level of model.levels) {
      floorArea +=
        Math.max(
          0,
          area2(level.outline) - level.voids.reduce((s, v) => s + area2(v), 0),
        ) / SF;
      for (const l of polygonFraming(
        level.outline,
        level.voids,
        settings.spacingMm,
      ))
        add(
          level.id,
          level.label,
          "floor preview",
          "joist",
          Math.hypot(l.end[0] - l.start[0], l.end[1] - l.start[1]),
        );
    }
  if (settings.includeRoofFraming)
    for (const roof of model.roofs) {
      if (roof.surface === "roof-deck") continue;
      roofArea +=
        Math.max(
          0,
          area3(roof.vertices) -
            (roof.voids ?? []).reduce((s, v) => s + area3(v), 0),
        ) / SF;
      for (const l of polygonFraming(
        roof.vertices.map((v) => [v[0], v[2]]),
        (roof.voids ?? []).map((h) => h.map((v) => [v[0], v[2]])),
        settings.spacingMm,
      )) {
        const y0 = roofHeight(roof.vertices, l.start[0], l.start[1]),
          y1 = roofHeight(roof.vertices, l.end[0], l.end[1]);
        add(
          roof.id,
          roof.label,
          "roof preview",
          "joist",
          Math.hypot(l.end[0] - l.start[0], y1 - y0, l.end[1] - l.start[1]),
        );
      }
    }
  const lines: EstimateLine[] = [];
  const names = {
    stud: "Studs",
    track: "Tracks",
    header: "Headers",
    joist: "Joists / perimeter members",
  };
  for (const kind of ["stud", "track", "header", "joist"] as const) {
    const quantity = round(
      quantities
        .filter((q) => q.kind === kind)
        .reduce((sum, q) => sum + q.lengthFt, 0),
    );
    const billableQuantity = round(
      quantity * (1 + settings.wastePercent / 100),
    );
    if (quantity)
      lines.push({
        id: kind,
        label: names[kind],
        category: "material",
        quantity,
        billableQuantity,
        unit: "LF",
        rate: settings.rates[kind],
        amount: round(billableQuantity * settings.rates[kind]),
      });
  }
  if (settings.includeLabor)
    for (const [id, label, area] of [
      ["wallLabor", "Wall framing installation", wallArea],
      ["floorLabor", "Floor framing installation", floorArea],
      ["roofLabor", "Roof framing installation", roofArea],
    ] as const) {
      const quantity = round(area);
      if (quantity)
        lines.push({
          id,
          label,
          category: "labor",
          quantity,
          billableQuantity: quantity,
          unit: "SF",
          rate: settings.rates[id],
          amount: round(quantity * settings.rates[id]),
        });
    }
  const materials = round(
    lines
      .filter((l) => l.category === "material")
      .reduce((s, l) => s + l.amount, 0),
  );
  const labor = round(
    lines
      .filter((l) => l.category === "labor")
      .reduce((s, l) => s + l.amount, 0),
  );
  const delivery = quantities.length ? round(settings.delivery) : 0;
  const direct = round(materials + labor + delivery);
  const contingency = round((direct * settings.contingencyPercent) / 100);
  const markup = round(((direct + contingency) * settings.markupPercent) / 100);
  const total = round(direct + contingency + markup);
  if (
    !Number.isFinite(total) ||
    Math.round(total * 100) > Number.MAX_SAFE_INTEGER
  )
    throw new Error("Estimate exceeds the supported calculation range.");
  const byElement = new Map<string, Quantity[]>();
  for (const q of quantities) {
    const list = byElement.get(q.elementId) ?? [];
    list.push(q);
    byElement.set(q.elementId, list);
  }
  const wallPanels = model.walls.map((wall) => {
    const assembly = customWalls.get(wall.id);
    const ids = new Set(assembly?.componentIds ?? [wall.id]);
    const members = [...ids].flatMap((id) => byElement.get(id) ?? []);
    const sum = (kinds: Kind[]) =>
      round(
        members
          .filter((q) => kinds.includes(q.kind))
          .reduce((s, q) => s + q.lengthFt, 0),
      );
    const openings = model.openings.filter((o) => o.wallId === wall.id);
    return {
      wallId: wall.id,
      label: wall.label,
      source: assembly ? "saved custom members" : FRAMING_TEMPLATE_VERSION,
      studLinearFeet: sum(["stud", "header"]),
      trackLinearFeet: sum(["track"]),
      totalLinearFeet: sum(["stud", "header", "track"]),
      connectionStudLinearFeet: round(
        members
          .filter((q) => q.role === "panel connection stud")
          .reduce((s, q) => s + q.lengthFt, 0),
      ),
      connectionReviewCount: connections.filter(
        (c) =>
          (c.throughWallId === wall.id || c.branchWallId === wall.id) &&
          c.messages.length,
      ).length,
      openingSizesToVerify: openings.filter(
        (o) => !o.dimensionBasis || o.dimensionBasis === "unknown",
      ).length,
      headersToReview: openings.filter(
        (o) =>
          o.sill + o.height + BOX_HEADER_WEB + 38 >
          minimumWallTop(wall, o.offset, o.offset + o.width),
      ).length,
    };
  });
  return {
    wallPanels,
    panelConnections: connections,
    connectionReviewCount: connections.filter((c) => c.messages.length).length,
    framingTemplate: FRAMING_TEMPLATE_VERSION,
    openingSizesToVerify: wallPanels.reduce(
      (s, p) => s + p.openingSizesToVerify,
      0,
    ),
    headersToReview: wallPanels.reduce((s, p) => s + p.headersToReview, 0),
    version: 1 as const,
    label: "MOCK PRICING — PRELIMINARY FRAMING ESTIMATE",
    currency: "USD",
    name: model.name,
    settings,
    lines,
    quantities,
    materials,
    labor,
    delivery,
    direct,
    contingency,
    markup,
    total,
    wallArea: round(wallArea),
    floorArea: round(floorArea),
    roofArea: round(roofArea),
    unpricedBoxes: model.components.filter((c) => c.kind === "box").length,
    unresolvedIssues: model.issues.filter((i) => !i.resolved).length,
    unconfirmedScales: model.calibrations.filter((c) => !c.confirmed).length,
    exclusions: ESTIMATE_EXCLUSIONS,
  };
}
export type Estimate = ReturnType<typeof buildEstimate>;
export function estimateCsv(
  estimate: Estimate,
  revision: string | null,
  unsaved: boolean,
): string {
  const rows: unknown[][] = [
    [estimate.label],
    ["Project", estimate.name],
    ["Revision", revision ?? "No saved revision"],
    ["Unsaved changes", unsaved ? "Yes" : "No"],
    ["Currency", "USD"],
    [],
    [
      "Item",
      "Quantity",
      "Unit",
      "Quantity incl. waste",
      "Mock unit rate USD",
      "Amount USD",
    ],
  ];
  for (const l of estimate.lines)
    rows.push([
      l.label,
      l.quantity,
      l.unit,
      l.billableQuantity,
      l.rate,
      l.amount,
    ]);
  rows.push(
    [],
    ["Materials incl. waste", estimate.materials],
    ["Labor", estimate.labor],
    ["Delivery", estimate.delivery],
    ["Direct subtotal", estimate.direct],
    [
      `Contingency (${estimate.settings.contingencyPercent}%) on direct subtotal`,
      estimate.contingency,
    ],
    [
      `Markup (${estimate.settings.markupPercent}%) on subtotal + contingency`,
      estimate.markup,
    ],
    ["MOCK TOTAL — tax excluded", estimate.total],
    [],
    ["Waste percent (materials only)", estimate.settings.wastePercent],
    ["Spacing mm", estimate.settings.spacingMm],
    ["Floor framing included", estimate.settings.includeFloorFraming],
    ["Roof framing included", estimate.settings.includeRoofFraming],
    ["Unpriced generic boxes", estimate.unpricedBoxes],
    ["Unresolved model issues", estimate.unresolvedIssues],
    ["Unconfirmed scales", estimate.unconfirmedScales],
    [],
    ["Assumptions and exclusions"],
  );
  for (const text of estimate.exclusions) rows.push([text]);
  rows.push(
    [],
    ["Wall panel linear feet — before waste"],
    [
      "Wall",
      "Studs incl. header C members LF",
      "Tracks LF",
      "Total LF",
      "Opening sizes to verify",
      "Header fit checks",
      "Template/source",
      "Connection stud LF (included in stud total)",
      "Connection review checks",
    ],
  );
  for (const p of estimate.wallPanels)
    rows.push([
      p.label,
      p.studLinearFeet,
      p.trackLinearFeet,
      p.totalLinearFeet,
      p.openingSizesToVerify,
      p.headersToReview,
      p.source,
      p.connectionStudLinearFeet,
      p.connectionReviewCount,
    ]);
  rows.push(
    [],
    ["Quantity detail — illustrative geometry, not stock orders"],
    ["Element ID", "Label", "Source", "Kind", "Length LF"],
  );
  for (const q of estimate.quantities)
    rows.push([q.elementId, q.label, q.source, q.kind, round(q.lengthFt)]);
  return rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value);
          if (typeof value === "string" && /^[\s]*[=+@-]/.test(text))
            text = "'" + text;
          return '"' + text.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
