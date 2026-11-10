"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { BuildingModel, wallPieces, length } from "@/lib/model";
import { transformElement, addElement } from "@/lib/editing";
import { wallFraming, polygonFraming, roofHeight } from "@/lib/framing";
type Props = {
  model: BuildingModel;
  selected: string | null;
  mode: "translate" | "rotate" | "scale";
  levelId: string;
  roofVisible: boolean;
  framing: boolean;
  spacing: number;
  top: boolean;
  onSelect: (id: string | null) => void;
  onChange: (m: BuildingModel) => void;
  onError: (s: string) => void;
  onEditMember: (wallId: string, index: number) => void;
};
export default function ModelViewer(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const api = useRef<{
    draw: () => void;
    select: () => void;
    view: () => void;
  } | null>(null);
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      latest.current.onError(
        "3D rendering is unavailable in this browser. Try a browser with WebGL enabled.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#ededed");
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
    camera.position.set(25, 24, 30);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.maxPolarAngle = Math.PI / 2.02;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x79787d, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(-20, 40, 15);
    scene.add(sun);
    const grid = new THREE.GridHelper(120, 120, 0xacacac, 0xc8c8c8);
    grid.position.y = -0.2;
    scene.add(grid);
    const root = new THREE.Group();
    scene.add(root);
    const objects = new Map<string, THREE.Group>();
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.9);
    scene.add(transform.getHelper());
    let initial: { pos: THREE.Vector3; angle: number } | null = null,
      dragged = false;
    const select = () => {
      transform.detach();
      const p = latest.current,
        g = objects.get(p.selected || "");
      if (g) {
        transform.attach(g);
        transform.setMode(p.mode);
        transform.setSpace(p.mode === "scale" ? "local" : "world");
        transform.showX = p.mode !== "rotate";
        transform.showY =
          p.mode === "rotate" ||
          p.mode === "scale" ||
          p.model.components.some((c) => c.id === p.selected) ||
          p.model.openings.some((o) => o.id === p.selected) ||
          p.model.levels.some((l) => l.id === p.selected);
        transform.showZ = p.mode !== "rotate";
      }
    };
    transform.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !e.value;
      dragged = !!e.value;
    });
    transform.addEventListener("mouseDown", () => {
      const g = transform.object;
      if (g) initial = { pos: g.position.clone(), angle: g.rotation.y };
    });
    transform.addEventListener("mouseUp", () => {
      const g = transform.object,
        p = latest.current;
      if (g && initial && p.selected) {
        const m = transformElement(p.model, p.selected, {
          dx: (g.position.x - initial.pos.x) * 1000,
          dz: (g.position.z - initial.pos.z) * 1000,
          dy: (g.position.y - initial.pos.y) * 1000,
          rotation: -(g.rotation.y - initial.angle),
          sx: Math.max(0.01, g.scale.x),
          sy: Math.max(0.01, g.scale.y),
          sz: Math.max(0.01, g.scale.z),
        });
        initial = null;
        p.onChange(m);
      }
    });
    const material = (color: string) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
    const steel = (color: string) =>
      new THREE.MeshStandardMaterial({
        color,
        metalness: 0.55,
        roughness: 0.36,
      });
    // One instanced draw call per assembly/material keeps full buildings interactive.
    const members = (
      g: THREE.Group,
      matrices: THREE.Matrix4[],
      color: string,
      memberIndices?: number[],
    ) => {
      if (!matrices.length) return;
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        steel(color),
        matrices.length,
      );
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (memberIndices) mesh.userData.memberIndices = memberIndices;
      g.add(mesh);
    };
    const memberLines = (
      g: THREE.Group,
      lines: { start: number[]; end: number[] }[],
      color: string,
    ) => {
      const matrices = lines.flatMap(({ start, end }) => {
        const a = new THREE.Vector3(
          ...(start as [number, number, number]),
        ).multiplyScalar(0.001);
        const b = new THREE.Vector3(
          ...(end as [number, number, number]),
        ).multiplyScalar(0.001);
        const direction = b.clone().sub(a),
          distance = direction.length();
        if (distance < 0.001) return [];
        direction.normalize();
        const side = new THREE.Vector3()
          .crossVectors(direction, new THREE.Vector3(0, 1, 0))
          .normalize();
        const up = new THREE.Vector3()
          .crossVectors(side, direction)
          .normalize();
        return [
          new THREE.Matrix4().compose(
            a.add(b).multiplyScalar(0.5),
            new THREE.Quaternion().setFromRotationMatrix(
              new THREE.Matrix4().makeBasis(direction, up, side),
            ),
            new THREE.Vector3(distance, 0.15, 0.038),
          ),
        ];
      });
      members(g, matrices, color);
    };
    const box = (
      g: THREE.Group,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: string,
    ) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(
          Math.max(w, 0.001),
          Math.max(h, 0.001),
          Math.max(d, 0.001),
        ),
        material(color),
      );
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    const clear = () => {
      transform.detach();
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          if (o instanceof THREE.InstancedMesh) o.dispose();
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
      root.clear();
      objects.clear();
    };
    const group = (id: string) => {
      const g = new THREE.Group();
      g.userData.elementId = id;
      root.add(g);
      objects.set(id, g);
      return g;
    };
    const draw = () => {
      clear();
      const p = latest.current,
        m = p.model;
      const visible = (id: string) => !p.levelId || p.levelId === id;
      for (const l of m.levels) {
        if (!visible(l.id) || l.outline.length < 3) continue;
        const g = group(l.id),
          cx = l.outline.reduce((s, v) => s + v[0], 0) / l.outline.length,
          cz = l.outline.reduce((s, v) => s + v[1], 0) / l.outline.length;
        g.position.set(cx / 1000, l.elevation / 1000, cz / 1000);
        if (p.framing) {
          memberLines(
            g,
            polygonFraming(l.outline, l.voids, p.spacing).map((line) => ({
              start: [line.start[0] - cx, -75, line.start[1] - cz],
              end: [line.end[0] - cx, -75, line.end[1] - cz],
            })),
            p.selected === l.id ? "#fff895" : "#acacac",
          );
          continue;
        }
        const shape = new THREE.Shape(
          l.outline.map(
            (v) => new THREE.Vector2((v[0] - cx) / 1000, -(v[1] - cz) / 1000),
          ),
        );
        for (const hole of l.voids)
          shape.holes.push(
            new THREE.Path(
              hole.map(
                (v) =>
                  new THREE.Vector2((v[0] - cx) / 1000, -(v[1] - cz) / 1000),
              ),
            ),
          );
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: 0.15,
          bevelEnabled: false,
        });
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, -0.15, 0);
        g.add(new THREE.Mesh(geometry, material("#c8c8c8")));
      }
      for (const w of m.walls) {
        if (!visible(w.levelId)) continue;
        const l = m.levels.find((l) => l.id === w.levelId);
        if (!l) continue;
        const g = group(w.id),
          len = length(w) / 1000;
        g.position.set(
          (w.start[0] + w.end[0]) / 2000,
          l.elevation / 1000,
          (w.start[1] + w.end[1]) / 2000,
        );
        g.rotation.y = -Math.atan2(
          w.end[1] - w.start[1],
          w.end[0] - w.start[0],
        );
        if (p.framing) {
          if (m.framingAssemblies?.some((a) => a.wallId === w.id)) continue;
          const pieces = wallFraming(w, m.openings, p.spacing);
          for (const kind of ["stud", "track", "header"] as const) {
            members(
              g,
              pieces
                .filter((v) => v.kind === kind)
                .map((v) =>
                  new THREE.Matrix4().compose(
                    new THREE.Vector3(v.x / 1000 - len / 2, v.y / 1000, 0),
                    new THREE.Quaternion(),
                    new THREE.Vector3(
                      v.width / 1000,
                      v.height / 1000,
                      w.thickness / 1000,
                    ),
                  ),
                ),
              p.selected === w.id
                ? "#fff895"
                : kind === "header"
                  ? "#4b412b"
                  : kind === "track"
                    ? "#544f4c"
                    : "#acacac",
              pieces.flatMap((v, index) => (v.kind === kind ? [index] : [])),
            );
          }
          continue;
        }
        for (const piece of wallPieces(w, m.openings))
          box(
            g,
            (piece.a + piece.b) / 2000 - len / 2,
            (piece.bottom + piece.top) / 2000,
            0,
            (piece.b - piece.a) / 1000,
            (piece.top - piece.bottom) / 1000,
            w.thickness / 1000,
            p.selected === w.id ? "#fff895" : "#ededed",
          );
      }
      for (const o of m.openings) {
        const w = m.walls.find((w) => w.id === o.wallId),
          l = m.levels.find((l) => l.id === w?.levelId);
        if (!w || !l || !visible(l.id)) continue;
        const g = group(o.id),
          a = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]),
          t = o.offset + o.width / 2;
        g.position.set(
          (w.start[0] + Math.cos(a) * t) / 1000,
          (l.elevation + o.sill + o.height / 2) / 1000,
          (w.start[1] + Math.sin(a) * t) / 1000,
        );
        g.rotation.y = -a;
        if (p.framing) {
          // Thin selectable opening outline; the aperture remains empty.
          const width = o.width / 1000,
            height = o.height / 1000;
          const color = p.selected === o.id ? "#fff895" : "#4b412b";
          for (const x of [-width / 2, width / 2])
            box(g, x, 0, 0, 0.012, height, 0.018, color);
          for (const y of [-height / 2, height / 2])
            box(g, 0, y, 0, width, 0.012, 0.018, color);
          continue;
        }
        box(
          g,
          0,
          0,
          0,
          o.width / 1000,
          o.height / 1000,
          0.045,
          p.selected === o.id
            ? "#fff895"
            : o.kind === "window"
              ? "#c8c8c8"
              : "#544f4c",
        );
      }
      for (const c of m.components) {
        const custom = m.framingAssemblies?.some((a) =>
          a.componentIds.includes(c.id),
        );
        if (custom && !p.framing) continue;
        const l = m.levels.find((l) => l.id === c.levelId);
        if (!l || !visible(l.id)) continue;
        const g = group(c.id);
        g.position.set(
          c.center[0] / 1000,
          (l.elevation + c.elevation + c.height / 2) / 1000,
          c.center[1] / 1000,
        );
        g.rotation.y = (-c.rotation * Math.PI) / 180;
        box(
          g,
          0,
          0,
          0,
          c.length / 1000,
          c.height / 1000,
          c.depth / 1000,
          p.selected === c.id
            ? "#fff895"
            : c.kind === "header"
              ? "#4b412b"
              : c.kind === "track"
                ? "#544f4c"
                : "#acacac",
        );
      }
      if (p.roofVisible)
        for (const r of m.roofs) {
          if (!visible(r.levelId)) continue;
          const g = group(r.id),
            cx = r.vertices.reduce((s, v) => s + v[0], 0) / r.vertices.length,
            cz = r.vertices.reduce((s, v) => s + v[2], 0) / r.vertices.length;
          g.position.set(cx / 1000, 0, cz / 1000);
          if (p.framing) {
            memberLines(
              g,
              polygonFraming(
                r.vertices.map((v) => [v[0], v[2]]),
                (r.voids ?? []).map((h) => h.map((v) => [v[0], v[2]])),
                p.spacing,
              ).map((line) => ({
                start: [
                  line.start[0] - cx,
                  roofHeight(r.vertices, line.start[0], line.start[1]),
                  line.start[1] - cz,
                ],
                end: [
                  line.end[0] - cx,
                  roofHeight(r.vertices, line.end[0], line.end[1]),
                  line.end[1] - cz,
                ],
              })),
              p.selected === r.id ? "#fff895" : "#acacac",
            );
            continue;
          }
          const allRoofPoints = [...r.vertices, ...(r.voids ?? []).flat()];
          const triangles = THREE.ShapeUtils.triangulateShape(
              r.vertices.map((v) => new THREE.Vector2(v[0], v[2])),
              (r.voids ?? []).map((h) =>
                h.map((v) => new THREE.Vector2(v[0], v[2])),
              ),
            ),
            vertices = triangles.flatMap((t) =>
              t.flatMap((i) => [
                (allRoofPoints[i][0] - cx) / 1000,
                allRoofPoints[i][1] / 1000,
                (allRoofPoints[i][2] - cz) / 1000,
              ]),
            );
          const geo = new THREE.BufferGeometry();
          geo.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(vertices, 3),
          );
          geo.computeVertexNormals();
          const mat = material("#79787d");
          mat.side = THREE.DoubleSide;
          g.add(new THREE.Mesh(geo, mat));
        }
      select();
    };
    const view = () => {
      const b = new THREE.Box3().setFromObject(root),
        center = b.isEmpty()
          ? new THREE.Vector3(5, 0, 5)
          : b.getCenter(new THREE.Vector3()),
        size = b.isEmpty()
          ? 18
          : Math.max(12, b.getSize(new THREE.Vector3()).length());
      orbit.target.copy(center);
      if (latest.current.top)
        camera.position.set(center.x, center.y + size * 1.35, center.z + 0.01);
      else
        camera.position
          .copy(center)
          .add(new THREE.Vector3(size * 0.85, size * 0.75, size * 0.95));
      camera.updateProjectionMatrix();
      orbit.update();
    };
    const ray = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    const point = (e: { clientX: number; clientY: number }) => {
      const b = el.getBoundingClientRect();
      pointer.set(
        ((e.clientX - b.left) / b.width) * 2 - 1,
        (-(e.clientY - b.top) / b.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
    };
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (
        dragged ||
        transform.axis ||
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5
      )
        return;
      point(e);
      const hit = ray.intersectObject(root, true)[0];
      if (hit?.instanceId !== undefined && hit.object.userData.memberIndices) {
        const wallId = hit.object.parent?.userData.elementId;
        if (wallId) {
          latest.current.onEditMember(
            wallId,
            hit.object.userData.memberIndices[hit.instanceId],
          );
          return;
        }
      }
      let obj: THREE.Object3D | null = hit?.object ?? null;
      while (obj && !obj.userData.elementId) obj = obj.parent;
      latest.current.onSelect(obj?.userData.elementId ?? null);
    };
    const onDrag = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer?.getData("application/fraaime-component");
      if (!kind) return;
      point(e);
      const p = latest.current,
        l = p.model.levels.find((l) => l.id === p.levelId) || p.model.levels[0];
      if (!l && kind !== "floor") {
        p.onError("Add a floor before adding components.");
        return;
      }
      const pos = new THREE.Vector3();
      if (
        !ray.ray.intersectPlane(
          new THREE.Plane(
            new THREE.Vector3(0, 1, 0),
            -(l?.elevation ?? 0) / 1000,
          ),
          pos,
        )
      )
        return;
      const result = addElement(
        p.model,
        kind,
        l?.id ?? "",
        pos.x * 1000,
        pos.z * 1000,
      );
      p.onChange(result.model);
      p.onSelect(result.id);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    el.addEventListener("dragover", onDrag);
    el.addEventListener("drop", onDrop);
    const resize = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    const safeDraw = () => {
      try {
        draw();
      } catch (error) {
        latest.current.onError(
          error instanceof Error
            ? error.message
            : "Unable to show framing for this geometry.",
        );
      }
    };
    safeDraw();
    view();
    api.current = { draw: safeDraw, select, view };
    renderer.setAnimationLoop(() => {
      orbit.update();
      renderer.render(scene, camera);
    });
    return () => {
      api.current = null;
      resize.disconnect();
      renderer.setAnimationLoop(null);
      el.removeEventListener("dragover", onDrag);
      el.removeEventListener("drop", onDrop);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      clear();
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      el.replaceChildren();
    };
  }, []);
  useEffect(() => {
    api.current?.draw();
  }, [
    props.model,
    props.selected,
    props.levelId,
    props.roofVisible,
    props.framing,
    props.spacing,
  ]);
  useEffect(() => {
    api.current?.select();
  }, [props.mode]);
  useEffect(() => {
    api.current?.view();
  }, [props.top, props.model.name]);
  return (
    <div
      className="canvas"
      ref={host}
      aria-label="Editable 3D building model"
    />
  );
}
