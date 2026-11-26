import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FURNITURE, type Furniture } from "./furniture";
import type { TourMaterials } from "./walkthrough-materials";

/** Presentation meshes stay inside the saved collision footprint. */
export function createTourFurniture(f: Furniture, m: TourMaterials) {
  const group = new THREE.Group();
  group.name = `Furniture: ${f.kind}`;
  const def = FURNITURE[f.kind],
    w = def.width / 1000,
    d = def.depth / 1000;
  function mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.castShadow = part.receiveShadow = true;
    group.add(part);
    return part;
  }
  function rounded(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
    radius = 0.035,
  ) {
    return mesh(
      new RoundedBoxGeometry(width, height, depth, 2, radius),
      material,
      x,
      y,
      z,
    );
  }
  function leg(
    x: number,
    z: number,
    height: number,
    radius = 0.028,
    material = m.wood,
  ) {
    return mesh(
      new THREE.CylinderGeometry(radius, radius * 0.7, height, 12),
      material,
      x,
      height / 2,
      z,
    );
  }
  // Bounded, soft contact shading grounds furniture even without direct sunlight.
  const contact = mesh(new THREE.PlaneGeometry(w, d), m.contact, 0, 0.004, 0);
  contact.rotation.x = -Math.PI / 2;
  contact.castShadow = contact.receiveShadow = false;
  let shade: THREE.MeshStandardMaterial | undefined;
  if (f.kind === "sofa") {
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        leg(x * (w / 2 - 0.15), z * (d / 2 - 0.14), 0.17);
    rounded(0, 0.265, 0, w - 0.06, 0.24, d - 0.04, m.upholstery, 0.07);
    rounded(0, 0.62, d / 2 - 0.12, w - 0.07, 0.46, 0.24, m.upholstery, 0.07);
    for (const sign of [-1, 1]) {
      rounded(
        sign * (w / 2 - 0.11),
        0.48,
        0,
        0.22,
        0.4,
        d - 0.02,
        m.upholstery,
        0.07,
      );
      // Narrow piping beneath the seat creates a readable seam, not an oversized edge.
      rounded(sign * 0.445, 0.427, -0.075, 0.864, 0.018, 0.665, m.seam, 0.008);
      rounded(sign * 0.445, 0.46, -0.075, 0.86, 0.145, 0.66, m.cushion, 0.055);
      const back = rounded(
        sign * 0.445,
        0.68,
        0.25,
        0.855,
        0.31,
        0.16,
        m.cushion,
        0.06,
      );
      back.rotation.x = -0.1;
      const pillow = rounded(
        sign * 0.67,
        0.64,
        0.08,
        0.3,
        0.31,
        0.12,
        sign < 0 ? m.linen : m.accent,
        0.055,
      );
      pillow.rotation.set(-0.18, 0, sign * -0.16);
    }
  } else if (f.kind === "bed") {
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        leg(x * (w / 2 - 0.12), z * (d / 2 - 0.18), 0.16);
    rounded(0, 0.25, 0, w, 0.24, d, m.wood, 0.025);
    rounded(0, 0.64, d / 2 - 0.075, w, 0.62, 0.15, m.linen, 0.055);
    rounded(0, 0.46, -0.06, w - 0.04, 0.24, d - 0.19, m.linen, 0.09);
    rounded(0, 0.59, -0.33, w - 0.015, 0.09, 1.45, m.linen, 0.045);
    for (const sign of [-1, 1]) {
      const pillow = rounded(
        sign * 0.38,
        0.625,
        0.65,
        0.66,
        0.15,
        0.43,
        m.linen,
        0.07,
      );
      pillow.rotation.y = sign * 0.035;
    }
    rounded(0, 0.65, -0.6, w - 0.015, 0.035, 0.6, m.blanket, 0.016);
    for (let i = 0; i < 7; i++)
      rounded(
        -0.66 + i * 0.22,
        0.669,
        -0.6,
        0.035,
        0.008,
        0.56,
        m.blanket,
        0.004,
      );
  } else if (f.kind === "table") {
    rounded(0, 0.72, 0, w, 0.06, d, m.wood, 0.028);
    rounded(0, 0.63, 0, w - 0.2, 0.12, d - 0.22, m.wood, 0.014);
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        leg(x * (w / 2 - 0.12), z * (d / 2 - 0.12), 0.7, 0.04);
    // A shallow ceramic bowl adds scale without extending the tabletop footprint.
    const ceramic = m.linen;
    const bowl = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.04, 0),
        new THREE.Vector2(0.1, 0.015),
        new THREE.Vector2(0.14, 0.07),
        new THREE.Vector2(0.13, 0.072),
        new THREE.Vector2(0.09, 0.027),
        new THREE.Vector2(0.04, 0.015),
      ],
      24,
    );
    mesh(bowl, ceramic, 0, 0.75, 0);
  } else if (f.kind === "chair") {
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        leg(x * (w / 2 - 0.07), z * (d / 2 - 0.08), 0.43, 0.023);
    rounded(0, 0.425, 0, w - 0.02, 0.06, d - 0.02, m.wood, 0.025);
    rounded(0, 0.47, -0.015, w - 0.04, 0.08, d - 0.065, m.linen, 0.035);
    for (const x of [-1, 1])
      rounded(
        x * (w / 2 - 0.055),
        0.63,
        d / 2 - 0.055,
        0.04,
        0.42,
        0.04,
        m.wood,
        0.015,
      );
    rounded(0, 0.72, d / 2 - 0.06, w - 0.045, 0.25, 0.09, m.upholstery, 0.04);
  } else {
    mesh(
      new THREE.CylinderGeometry(0.17, 0.18, 0.035, 32),
      m.darkMetal,
      0,
      0.018,
      0,
    );
    leg(0, 0, 1.46, 0.012, m.metal);
    shade = m.linen.clone();
    shade.side = THREE.DoubleSide;
    shade.emissive.set("#ffd7a0");
    shade.emissiveIntensity = 0;
    mesh(
      new THREE.CylinderGeometry(0.15, 0.21, 0.35, 40, 1, true),
      shade,
      0,
      1.425,
      0,
    ).castShadow = false;
    for (const [radius, y] of [
      [0.15, 1.6],
      [0.21, 1.25],
    ]) {
      const rim = mesh(
        new THREE.TorusGeometry(radius - 0.004, 0.004, 6, 40),
        m.linen,
        0,
        y,
        0,
      );
      rim.rotation.x = Math.PI / 2;
      rim.castShadow = false;
    }
  }
  return { group, shade };
}
