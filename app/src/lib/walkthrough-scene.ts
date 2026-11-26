import * as THREE from "three";
import { type BuildingModel, length, wallPieces } from "./model";
import { createTourMaterials } from "./walkthrough-materials";
import { createTourFurniture } from "./walkthrough-furniture";
import { floorBounds } from "./walkthrough";

export type TourLighting = "day" | "sunset" | "night";
const palettes = {
  day: {
    sky: "#b7d8ed",
    horizon: "#eaf1ed",
    ground: "#819478",
    sun: "#fff2da",
    ambient: 0.7,
    direct: 3.6,
    angle: 0.85,
  },
  sunset: {
    sky: "#626e9a",
    horizon: "#f7bd97",
    ground: "#696d5d",
    sun: "#ffab62",
    ambient: 0.4,
    direct: 2.2,
    angle: 0.22,
  },
  night: {
    sky: "#081221",
    horizon: "#27364c",
    ground: "#24332d",
    sun: "#adc6f1",
    ambient: 0.12,
    direct: 0.22,
    angle: 0.7,
  },
};
export function disposeScene(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        materials.add(m),
      );
    }
    if (o instanceof THREE.Light && "dispose" in o)
      (o as THREE.DirectionalLight).dispose();
  });
  materials.forEach((m) => {
    for (const value of Object.values(m))
      if (value instanceof THREE.Texture) textures.add(value);
    m.dispose();
  });
  textures.forEach((t) => t.dispose());
  geometries.forEach((g) => g.dispose());
  root.clear();
}
export function buildWalkthroughScene(
  model: BuildingModel,
  levelId: string,
  ceiling: boolean,
) {
  const scene = new THREE.Scene();
  const finishes = createTourMaterials();
  const level = model.levels.find((l) => l.id === levelId)!;
  const bounds = floorBounds(level),
    cx = (bounds.minX + bounds.width / 2) / 1000,
    cz = (bounds.minZ + bounds.depth / 2) / 1000;
  const elevation = level.elevation / 1000;
  const extent = Math.max(bounds.width, bounds.depth) / 1000;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  function mat(color: string) {
    if (color === "#ded8cb") return finishes.trim;
    if (color === "#626866") return finishes.darkMetal;
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
    const floor = new THREE.Mesh(geo, finishes.floor);
    floor.position.y = elevation;
    floor.receiveShadow = true;
    scene.add(floor);
    if (ceiling) {
      const top = new THREE.Mesh(geo.clone(), finishes.ceiling);
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
      const mesh = new THREE.Mesh(geo, finishes.wall);
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
  for (const f of (model.furniture ?? []).filter(
    (f) => f.levelId === levelId,
  )) {
    const { group, shade } = createTourFurniture(f, finishes);
    group.position.set(f.center[0] / 1000, elevation, f.center[1] / 1000);
    group.rotation.y = (-f.rotation * Math.PI) / 180;
    scene.add(group);
    if (shade) {
      shades.push(shade);
      if (lamps.length < 4) {
        const light = new THREE.PointLight("#ffd7a5", 0, 9, 2);
        light.position.set(
          f.center[0] / 1000,
          elevation + 1.43,
          f.center[1] / 1000,
        );
        // Bound shadow cost; the first two lamps provide local occlusion at night.
        light.castShadow = lamps.length < 2;
        light.shadow.mapSize.set(512, 512);
        light.shadow.normalBias = 0.04;
        light.shadow.bias = -0.002;
        light.shadow.camera.near = 0.08;
        light.shadow.camera.far = 9;
        scene.add(light);
        lamps.push(light);
      }
    }
  }
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
  const hemi = new THREE.HemisphereLight("#dce9ff", "#9c8d76", 0.7);
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
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0001;
  sun.target.position.set(cx, elevation, cz);
  scene.add(sun, sun.target);
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(3, 16, 12),
    new THREE.MeshBasicMaterial({ color: "#fff1ca" }),
  );
  scene.add(sunDisc);
  // Soft, bounded interior fill keeps night usable even in unfurnished models.
  const fill = new THREE.HemisphereLight("#ffe8c8", "#948578", 0);
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
      fill.intensity = interiorLights ? (preset === "night" ? 0.6 : 0.18) : 0;
      scene.environmentIntensity =
        preset === "day"
          ? 0.32
          : preset === "sunset"
            ? 0.2
            : interiorLights
              ? 0.13
              : 0.035;
      lamps.forEach((l) => (l.intensity = interiorLights ? 18 : 0));
      shades.forEach((s) => (s.emissiveIntensity = interiorLights ? 0.55 : 0));
    },
  };
}
