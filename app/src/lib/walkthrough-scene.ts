import * as THREE from "three";
import { type BuildingModel, length, wallPieces } from "./model";
import { FURNITURE, type Furniture } from "./furniture";
import { floorBounds } from "./walkthrough";

export type TourLighting = "day" | "sunset" | "night";
const palettes = {
  day: {
    sky: "#b7d8ed",
    horizon: "#eaf1ed",
    ground: "#819478",
    sun: "#fff2da",
    ambient: 1.7,
    direct: 3.2,
    angle: 0.85,
  },
  sunset: {
    sky: "#626e9a",
    horizon: "#f7bd97",
    ground: "#696d5d",
    sun: "#ffab62",
    ambient: 0.85,
    direct: 2.2,
    angle: 0.22,
  },
  night: {
    sky: "#081221",
    horizon: "#27364c",
    ground: "#24332d",
    sun: "#adc6f1",
    ambient: 0.35,
    direct: 0.35,
    angle: 0.7,
  },
};
export function disposeScene(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        materials.add(m),
      );
    }
    if (o instanceof THREE.Light && "dispose" in o)
      (o as THREE.DirectionalLight).dispose();
  });
  materials.forEach((m) => m.dispose());
  root.clear();
}
export function buildWalkthroughScene(
  model: BuildingModel,
  levelId: string,
  ceiling: boolean,
) {
  const scene = new THREE.Scene();
  const level = model.levels.find((l) => l.id === levelId)!;
  const bounds = floorBounds(level),
    cx = (bounds.minX + bounds.width / 2) / 1000,
    cz = (bounds.minZ + bounds.depth / 2) / 1000;
  const elevation = level.elevation / 1000;
  const extent = Math.max(bounds.width, bounds.depth) / 1000;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  function mat(color: string) {
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.82,
          side: THREE.DoubleSide,
        }),
      );
    return materials.get(color)!;
  }
  function box(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function floorShape() {
    const shape = new THREE.Shape(
      level.outline.map((p) => new THREE.Vector2(p[0] / 1000, -p[1] / 1000)),
    );
    for (const hole of level.voids.filter((h) => h.length >= 3))
      shape.holes.push(
        new THREE.Path(
          hole.map((p) => new THREE.Vector2(p[0] / 1000, -p[1] / 1000)),
        ),
      );
    return shape;
  }
  if (level.outline.length >= 3) {
    const geo = new THREE.ShapeGeometry(floorShape());
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, mat("#c2b29a"));
    floor.position.y = elevation;
    floor.receiveShadow = true;
    scene.add(floor);
    if (ceiling) {
      const top = new THREE.Mesh(geo.clone(), mat("#f4f1e9"));
      top.position.y = elevation + level.height / 1000;
      top.castShadow = true;
      top.receiveShadow = true;
      scene.add(top);
    }
  }
  for (const w of model.walls.filter((w) => w.levelId === levelId)) {
    const len = length(w) / 1000;
    if (len < 0.001) continue;
    const group = new THREE.Group();
    group.position.set(w.start[0] / 1000, elevation, w.start[1] / 1000);
    group.rotation.y = -Math.atan2(
      w.end[1] - w.start[1],
      w.end[0] - w.start[0],
    );
    scene.add(group);
    for (const p of wallPieces(w, model.openings)) {
      const a = "topA" in p ? Number(p.topA) : p.top,
        b = "topB" in p ? Number(p.topB) : p.top;
      const shape = new THREE.Shape([
        new THREE.Vector2(p.a / 1000, p.bottom / 1000),
        new THREE.Vector2(p.b / 1000, p.bottom / 1000),
        new THREE.Vector2(p.b / 1000, b / 1000),
        new THREE.Vector2(p.a / 1000, a / 1000),
      ]);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: w.thickness / 1000,
        bevelEnabled: false,
      });
      geo.translate(0, 0, -w.thickness / 2000);
      const mesh = new THREE.Mesh(geo, mat("#eeeae1"));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (p.bottom === 0)
        box(
          group,
          (p.a + p.b) / 2000,
          0.055,
          0,
          (p.b - p.a) / 1000,
          0.11,
          w.thickness / 1000 + 0.016,
          "#ded8cb",
        );
    }
    for (const o of model.openings.filter((o) => o.wallId === w.id)) {
      const x = (o.offset + o.width / 2) / 1000,
        y = (o.sill + o.height / 2) / 1000,
        ow = o.width / 1000,
        oh = o.height / 1000;
      // Doorways remain open in the tour; glazing must never cast an opaque shadow.
      for (const side of [-1, 1])
        box(
          group,
          x + (side * ow) / 2,
          y,
          0,
          0.045,
          oh,
          w.thickness / 1000 + 0.02,
          "#626866",
        );
      box(
        group,
        x,
        y + oh / 2,
        0,
        ow,
        0.045,
        w.thickness / 1000 + 0.02,
        "#626866",
      );
      if (o.kind === "window") {
        box(
          group,
          x,
          y - oh / 2,
          0,
          ow + 0.06,
          0.045,
          w.thickness / 1000 + 0.06,
          "#ded8cb",
        );
        const glass = new THREE.Mesh(
          new THREE.PlaneGeometry(ow, oh),
          new THREE.MeshStandardMaterial({
            color: "#b0d5dc",
            transparent: true,
            opacity: 0.13,
            roughness: 0.18,
            metalness: 0.12,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        glass.position.set(x, y, 0);
        group.add(glass);
      }
    }
  }
  const shades: THREE.MeshStandardMaterial[] = [],
    lamps: THREE.PointLight[] = [];
  function furnishing(f: Furniture) {
    const def = FURNITURE[f.kind],
      w = def.width / 1000,
      d = def.depth / 1000;
    const g = new THREE.Group();
    g.position.set(f.center[0] / 1000, elevation, f.center[1] / 1000);
    g.rotation.y = (-f.rotation * Math.PI) / 180;
    scene.add(g);
    const part = (
      x: number,
      y: number,
      z: number,
      width: number,
      height: number,
      depth: number,
      color = def.color,
    ) => box(g, x, y, z, width, height, depth, color);
    if (f.kind === "sofa") {
      part(0, 0.26, 0, w, 0.36, d);
      part(0, 0.65, d / 2 - 0.12, w, 0.4, 0.24);
      for (const sign of [-1, 1]) {
        part(sign * (w / 2 - 0.1), 0.52, 0, 0.2, 0.32, d);
        part(sign * 0.46, 0.49, -0.07, 0.87, 0.14, 0.65, "#8fa19d");
      }
    } else if (f.kind === "bed") {
      part(0, 0.22, 0, w, 0.3, d, "#7f6751");
      part(0, 0.46, -0.03, w - 0.04, 0.22, d - 0.08, "#e2ddd3");
      part(0, 0.65, d / 2 - 0.07, w, 0.6, 0.14);
      for (const sign of [-1, 1])
        part(sign * 0.39, 0.62, 0.68, 0.63, 0.12, 0.42, "#f7f2e5");
      part(0, 0.585, -0.42, w - 0.02, 0.04, 1.18, "#718184");
    } else if (f.kind === "table" || f.kind === "chair") {
      const seat = f.kind === "chair" ? 0.46 : 0.72;
      part(0, seat, 0, w, 0.06, d);
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          part(
            x * (w / 2 - 0.07),
            seat / 2,
            z * (d / 2 - 0.07),
            0.065,
            seat,
            0.065,
            "#544a40",
          );
      if (f.kind === "chair") part(0, 0.68, d / 2 - 0.035, w, 0.34, 0.07);
    } else {
      part(0, 0.025, 0, 0.34, 0.05, 0.34, "#484c49");
      part(0, 0.7, 0, 0.035, 1.4, 0.035, "#484c49");
      const shade = new THREE.MeshStandardMaterial({
        color: "#f2dfb7",
        emissive: "#ffca7c",
        emissiveIntensity: 0,
      });
      shades.push(shade);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.21, 0.35, 20),
        shade,
      );
      mesh.position.y = 1.425;
      g.add(mesh);
      if (lamps.length < 4) {
        const light = new THREE.PointLight("#ffce8c", 0, 7, 2);
        light.position.set(
          f.center[0] / 1000,
          elevation + 1.5,
          f.center[1] / 1000,
        );
        scene.add(light);
        lamps.push(light);
      }
    }
  }
  (model.furniture ?? [])
    .filter((f) => f.levelId === levelId)
    .forEach(furnishing);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(
      Math.max(600, extent * 8),
      Math.max(600, extent * 8),
    ),
    mat("#819478"),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, elevation - 0.25, cz);
  ground.receiveShadow = true;
  scene.add(ground);
  // A generic garden gives depth outside the windows; it is not site geography.
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2,
      radius = extent * 0.8 + 15 + (i % 3) * 5;
    const x = cx + Math.cos(angle) * radius,
      z = cz + Math.sin(angle) * radius;
    box(scene, x, elevation + 1.1, z, 0.3, 2.5, 0.3, "#645441");
    const tree = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.8 + (i % 3) * 0.3, 1),
      mat("#546d54"),
    );
    tree.position.set(x, elevation + 3, z);
    tree.scale.y = 1.4;
    scene.add(tree);
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(450, extent * 5), 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color() },
        bottomColor: { value: new THREE.Color() },
      },
      vertexShader:
        "varying vec3 vPosition; void main(){vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader:
        "uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vPosition; void main(){float h=clamp(normalize(vPosition).y,0.0,1.0); gl_FragColor=vec4(mix(bottomColor,topColor,pow(h,0.5)),1.0);\n #include <tonemapping_fragment>\n #include <colorspace_fragment>\n}",
    }),
  );
  sky.position.set(cx, elevation, cz);
  scene.add(sky);
  const hemi = new THREE.HemisphereLight("#dce9ff", "#c0c2c4", 1.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff2da", 3);
  sun.castShadow = true;
  const span = Math.max(15, extent * 0.8);
  Object.assign(sun.shadow.camera, {
    left: -span,
    right: span,
    top: span,
    bottom: -span,
    near: 0.1,
    far: span * 5 + 80,
  });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.025;
  sun.shadow.bias = -0.0001;
  sun.target.position.set(cx, elevation, cz);
  scene.add(sun, sun.target);
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(3, 16, 12),
    new THREE.MeshBasicMaterial({ color: "#fff1ca" }),
  );
  scene.add(sunDisc);
  // Soft, bounded interior fill keeps night usable even in unfurnished models.
  const fill = new THREE.HemisphereLight("#ffdfb3", "#b4aa9a", 0);
  scene.add(fill);
  return {
    scene,
    lighting(preset: TourLighting, interiorLights: boolean) {
      const p = palettes[preset];
      (sky.material as THREE.ShaderMaterial).uniforms.topColor.value.set(p.sky);
      (sky.material as THREE.ShaderMaterial).uniforms.bottomColor.value.set(
        p.horizon,
      );
      (ground.material as THREE.MeshStandardMaterial).color.set(p.ground);
      hemi.intensity = p.ambient;
      sun.color.set(p.sun);
      sun.intensity = p.direct;
      const dist = span * 2 + 30;
      sun.position.set(
        cx - dist * 0.65,
        elevation + dist * Math.sin(p.angle),
        cz - dist * 0.45,
      );
      sunDisc.position
        .copy(sun.position)
        .sub(sun.target.position)
        .normalize()
        .multiplyScalar(300)
        .add(sun.target.position);
      (sunDisc.material as THREE.MeshBasicMaterial).color.set(p.sun);
      fill.intensity = interiorLights ? (preset === "night" ? 1.1 : 0.45) : 0;
      lamps.forEach((l) => (l.intensity = interiorLights ? 12 : 0));
      shades.forEach((s) => (s.emissiveIntensity = interiorLights ? 0.8 : 0));
    },
  };
}
