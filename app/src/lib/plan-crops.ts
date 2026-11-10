import sharp from "sharp";
import type { BuildingModel } from "./model";
import type { PageEvidence } from "./worker";
import type { ShellDraftData } from "./shell";

/** Local drawing crops with an explicit full-page coordinate ruler. No provider calls. */
export async function planCoordinateCrops(
  page: PageEvidence,
  levels: ShellDraftData["levels"],
  model?: BuildingModel,
) {
  const outlines = levels
    .filter((l) => l.planPage === page.page)
    .flatMap((l) => l.outline);
  if (!outlines.length || !page.images.length) return [];
  // Recover the high-resolution sheet from the worker's four quarter tiles.
  const tiles = page.images.filter(
    (i) =>
      i.region[2] - i.region[0] === 0.5 && i.region[3] - i.region[1] === 0.5,
  );
  const full = page.images.find((i) => i.region.join(",") === "0,0,1,1");
  if (!full) return [];
  let raster = Buffer.from(full.base64, "base64");
  const expected = new Set([
    "0,0,0.5,0.5",
    "0.5,0,1,0.5",
    "0,0.5,0.5,1",
    "0.5,0.5,1,1",
  ]);
  if (
    tiles.length === 4 &&
    new Set(tiles.map((i) => i.region.join(","))).size === 4 &&
    tiles.every((i) => expected.has(i.region.join(",")))
  ) {
    const metadata = await Promise.all(
      tiles.map((i) => sharp(Buffer.from(i.base64, "base64")).metadata()),
    );
    const width = Math.max(...metadata.map((m) => m.width!)) * 2,
      height = Math.max(...metadata.map((m) => m.height!)) * 2;
    const inputs = await Promise.all(
      tiles.map((i) =>
        sharp(Buffer.from(i.base64, "base64"))
          .resize(width / 2, height / 2, { fit: "fill" })
          .png()
          .toBuffer(),
      ),
    );
    raster = await sharp({
      create: { width, height, channels: 3, background: "white" },
    })
      .composite(
        tiles.map((i, n) => ({
          input: inputs[n],
          left: Math.round(i.region[0] * width),
          top: Math.round(i.region[1] * height),
        })),
      )
      .png()
      .toBuffer();
  }
  const meta = await sharp(raster).metadata(),
    W = meta.width!,
    H = meta.height!;
  const x0 = Math.max(0, Math.min(...outlines.map((p) => p[0])) - 0.035);
  const x1 = Math.min(1, Math.max(...outlines.map((p) => p[0])) + 0.035);
  const y0 = Math.max(0, Math.min(...outlines.map((p) => p[1])) - 0.025);
  const y1 = Math.min(1, Math.max(...outlines.map((p) => p[1])) + 0.025);
  if (x1 <= x0 || y1 <= y0) return [];
  const images: { region: number[]; base64: string; overlay?: boolean }[] = [];
  for (let row = 0; row < 3; row++) {
    const a = Math.max(0, y0 + ((y1 - y0) * row) / 3 - 0.015),
      b = Math.min(1, y0 + ((y1 - y0) * (row + 1)) / 3 + 0.015);
    const left = Math.floor(x0 * W),
      top = Math.floor(a * H),
      right = Math.ceil(x1 * W),
      bottom = Math.ceil(b * H);
    const width = right - left,
      height = bottom - top;
    const region = [left / W, top / H, right / W, bottom / H];
    let ruler = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g font-family="sans-serif" font-size="12" fill="#005179">`;
    for (
      let n = Math.ceil(region[0] * 40);
      n <= Math.floor(region[2] * 40);
      n++
    ) {
      const x = (n / 40) * W - left;
      ruler += `<path d="M${x} 20V${height}" stroke="#007faa" stroke-opacity=".22" stroke-width="1"/><rect x="${x - 20}" y="0" width="44" height="18" fill="white"/><text x="${x - 17}" y="13">${(n / 40).toFixed(3)}</text>`;
    }
    for (
      let n = Math.ceil(region[1] * 40);
      n <= Math.floor(region[3] * 40);
      n++
    ) {
      const y = (n / 40) * H - top;
      ruler += `<path d="M44 ${y}H${width}" stroke="#007faa" stroke-opacity=".22" stroke-width="1"/><rect x="0" y="${y - 9}" width="44" height="18" fill="white"/><text x="2" y="${y + 4}">${(n / 40).toFixed(3)}</text>`;
    }
    ruler += "</g></svg>";
    const drawing = await sharp(raster)
      .extract({ left, top, width, height })
      .png()
      .toBuffer();
    const layers = [ruler];
    if (model) {
      let overlay = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
      const project = (p: number[], levelId: string) => {
        const level = levels.find(
          (l) => l.id === levelId && l.planPage === page.page,
        );
        if (!level?.scale) return null;
        const mm =
          level.scale.lengthMm /
          Math.hypot(
            (level.scale.end[0] - level.scale.start[0]) * page.width,
            (level.scale.end[1] - level.scale.start[1]) * page.height,
          );
        const angle = (level.rotationDegrees * Math.PI) / 180;
        return [
          ((p[0] * Math.cos(angle) + p[1] * Math.sin(angle)) / mm / page.width +
            level.anchor[0]) *
            W -
            left,
          ((-p[0] * Math.sin(angle) + p[1] * Math.cos(angle)) /
            mm /
            page.height +
            level.anchor[1]) *
            H -
            top,
        ];
      };
      for (const [i, wall] of model.walls.entries()) {
        const a = project(wall.start, wall.levelId),
          b = project(wall.end, wall.levelId);
        if (!a || !b) continue;
        overlay += `<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="#9f22b5" stroke-width="3" stroke-opacity=".75"/>`;
        const cx = (a[0] + b[0]) / 2,
          cy = (a[1] + b[1]) / 2;
        overlay += `<text x="${cx + 3}" y="${cy - 5}" font-family="sans-serif" font-size="12" fill="#720081" stroke="white" stroke-width="3" paint-order="stroke">W${i + 1}</text>`;
        const span = Math.hypot(
          wall.end[0] - wall.start[0],
          wall.end[1] - wall.start[1],
        );
        for (const o of model.openings.filter((o) => o.wallId === wall.id)) {
          const t = o.offset / span,
            u = (o.offset + o.width) / span;
          overlay += `<path d="M${a[0] + t * (b[0] - a[0])} ${a[1] + t * (b[1] - a[1])}L${a[0] + u * (b[0] - a[0])} ${a[1] + u * (b[1] - a[1])}" stroke="#008750" stroke-width="6"/>`;
        }
      }
      overlay += "</svg>";
      layers.push(overlay);
    }
    for (let variant = 0; variant < layers.length; variant++) {
      const annotated = await sharp(drawing)
        .composite(
          layers
            .slice(0, variant + 1)
            .map((svg) => ({ input: Buffer.from(svg) })),
        )
        .png()
        .toBuffer();
      const data = await sharp(annotated)
        .resize({
          width: 1536,
          height: 1536,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      images.push({
        region,
        base64: data.toString("base64"),
        overlay: variant === 1,
      });
    }
  }
  return images;
}
