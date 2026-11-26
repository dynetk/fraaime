"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { BuildingModel } from "@/lib/model";
import {
  buildWalkthroughScene,
  disposeScene,
  type TourLighting,
} from "@/lib/walkthrough-scene";
import {
  canStand,
  EYE_HEIGHT,
  findSpawn,
  initialYaw,
  moveWalker,
  type Navigation,
  type Position,
} from "@/lib/walkthrough";

export type TourPose = { position: Position; yaw: number };
type Props = {
  model: BuildingModel;
  nav: Navigation;
  ceiling: boolean;
  lighting: TourLighting;
  interiorLights: boolean;
  target: { position: Position; sequence: number } | null;
  onPose: (pose: TourPose) => void;
};
export default function WalkthroughCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState(""),
    [locked, setLocked] = useState(false);
  const keys = useRef(new Set<string>());
  const pose = useRef<{
    position: Position;
    yaw: number;
    pitch: number;
    levelId: string;
  } | null>(null);
  const engine = useRef<{
    lighting: (p: TourLighting, interior: boolean) => void;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
  } | null>(null);
  const { model, nav, ceiling, target, lighting, interiorLights } = props;
  useEffect(() => {
    const el = host.current!;
    setError("");
    setLocked(false);
    const start =
      pose.current?.levelId === nav.level.id &&
      canStand(nav, pose.current.position)
        ? pose.current.position
        : findSpawn(nav);
    if (!start) {
      setError(
        "No clear walking space on this floor. Try another floor or review its outline and walls.",
      );
      return;
    }
    pose.current = {
      position: start,
      yaw:
        pose.current?.levelId === nav.level.id
          ? pose.current.yaw
          : initialYaw(nav, start),
      pitch: 0,
      levelId: nav.level.id,
    };
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      setError(
        "3D rendering is unavailable. Try a browser with WebGL enabled.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute(
      "aria-label",
      "House walkthrough. W A S D to move, arrow keys to turn, drag to look, Escape to release mouse.",
    );
    el.appendChild(canvas);
    const camera = new THREE.PerspectiveCamera(68, 1, 0.04, 5000);
    camera.rotation.order = "YXZ";
    let world: ReturnType<typeof buildWalkthroughScene>;
    try {
      world = buildWalkthroughScene(model, nav.level.id, ceiling);
    } catch {
      renderer.dispose();
      canvas.remove();
      setError(
        "This floor could not be rendered. Review the model geometry or try another floor.",
      );
      return;
    }
    // A compact, locally generated reflection environment gives wood, fabric and
    // metal a readable response without loading external HDR assets.
    let environment: THREE.WebGLRenderTarget | undefined;
    const studio = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      environment = pmrem.fromScene(studio, 0.04);
      world.scene.environment = environment.texture;
    } catch {
      // Direct lights still render on devices without environment-map support.
    } finally {
      studio.dispose();
      pmrem.dispose();
    }
    const applyLighting = (preset: TourLighting, interior: boolean) => {
      world.lighting(preset, interior);
      // Geometry and lights are static while walking. Refresh only on a scene
      // rebuild or lighting change rather than rendering lamp cube maps per frame.
      renderer.shadowMap.needsUpdate = true;
    };
    applyLighting(latest.current.lighting, latest.current.interiorLights);
    engine.current = { lighting: applyLighting, camera, renderer };
    const resize = () => {
      const width = Math.max(1, el.clientWidth),
        height = Math.max(1, el.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let drag: { x: number; y: number; id: number } | null = null,
      disposed = false;
    const clear = () => {
      keys.current.clear();
      drag = null;
    };
    const lockChanged = () => {
      setLocked(document.pointerLockElement === canvas);
      clear();
    };
    const keyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.code)
      ) {
        e.preventDefault();
        e.stopPropagation();
        keys.current.add(e.code);
      }
    };
    const keyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      canvas.focus();
      if (document.pointerLockElement !== canvas) {
        drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
        canvas.setPointerCapture(e.pointerId);
      }
    };
    const move = (e: PointerEvent) => {
      if (!pose.current) return;
      const pointerLocked = document.pointerLockElement === canvas;
      if (!pointerLocked && !drag) return;
      const dx = pointerLocked ? e.movementX : e.clientX - drag!.x,
        dy = pointerLocked ? e.movementY : e.clientY - drag!.y;
      pose.current.yaw -= dx * 0.003;
      pose.current.pitch = THREE.MathUtils.clamp(
        pose.current.pitch - dy * 0.003,
        -1.35,
        1.35,
      );
      if (drag) {
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    };
    const up = () => {
      drag = null;
    };
    const visibility = () => {
      if (document.hidden) {
        clear();
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      }
    };
    const lost = (e: Event) => {
      e.preventDefault();
      clear();
      setError(
        "The 3D session was interrupted. Exit and reopen Walkthrough to restart it.",
      );
    };
    canvas.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("blur", clear);
    canvas.addEventListener("webglcontextlost", lost);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("pointerlockchange", lockChanged);
    let lastPose: TourPose | null = null;
    let frame = 0,
      previous = performance.now(),
      reported = 0;
    const animate = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      if (document.hidden || !pose.current) return;
      const p = pose.current,
        held = keys.current;
      p.yaw +=
        ((held.has("ArrowLeft") ? 1 : 0) - (held.has("ArrowRight") ? 1 : 0)) *
        dt *
        1.5;
      const forward =
        (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0) -
        (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0);
      const right = (held.has("KeyD") ? 1 : 0) - (held.has("KeyA") ? 1 : 0);
      const speed = (1800 * dt) / Math.max(1, Math.hypot(forward, right));
      if (forward || right)
        p.position = moveWalker(
          nav,
          p.position,
          (-Math.sin(p.yaw) * forward + Math.cos(p.yaw) * right) * speed,
          (-Math.cos(p.yaw) * forward - Math.sin(p.yaw) * right) * speed,
        );
      camera.position.set(
        p.position[0] / 1000,
        (nav.level.elevation + EYE_HEIGHT) / 1000,
        p.position[1] / 1000,
      );
      camera.rotation.set(p.pitch, p.yaw, 0, "YXZ");
      renderer.render(world.scene, camera);
      if (
        now - reported > 120 &&
        (!lastPose ||
          lastPose.yaw !== p.yaw ||
          lastPose.position[0] !== p.position[0] ||
          lastPose.position[1] !== p.position[1])
      ) {
        lastPose = { position: [...p.position], yaw: p.yaw };
        latest.current.onPose({ position: [...p.position], yaw: p.yaw });
        reported = now;
      }
    };
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      clear();
      observer.disconnect();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      canvas.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("blur", clear);
      canvas.removeEventListener("webglcontextlost", lost);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerlockchange", lockChanged);
      world.scene.environment = null;
      environment?.dispose();
      disposeScene(world.scene);
      renderer.dispose();
      canvas.remove();
      engine.current = null;
    };
  }, [model, nav, ceiling]);
  useEffect(() => {
    engine.current?.lighting(lighting, interiorLights);
  }, [lighting, interiorLights]);
  useEffect(() => {
    if (target && pose.current && canStand(nav, target.position)) {
      pose.current.position = [...target.position];
      pose.current.yaw = initialYaw(nav, target.position);
      pose.current.pitch = 0;
      keys.current.clear();
    }
  }, [target, nav]);
  const controls: [string, string][] = [
    ["Turn left", "ArrowLeft"],
    ["Forward", "KeyW"],
    ["Turn right", "ArrowRight"],
    ["Step left", "KeyA"],
    ["Back", "KeyS"],
    ["Step right", "KeyD"],
  ];
  return (
    <div className="tour-viewport-wrap">
      <div className="tour-viewport" ref={host} data-testid="tour-viewport" />
      {error ? (
        <div className="tour-overlay" role="alert">
          {error}
        </div>
      ) : (
        <>
          <div className="tour-caption">
            <span>{nav.level.label} · Eye level 5′5″</span>
            <span>
              {lighting === "day"
                ? "Daylight"
                : lighting === "sunset"
                  ? "Golden hour"
                  : "Night"}
            </span>
          </div>
          <div className="tour-crosshair" aria-hidden="true">
            +
          </div>
          <div className="tour-navigation">
            <button
              onClick={async () => {
                const canvas = engine.current?.renderer.domElement;
                if (locked) {
                  document.exitPointerLock();
                  return;
                }
                canvas?.focus();
                try {
                  await canvas?.requestPointerLock();
                } catch {
                  /* Drag-to-look and keyboard controls remain available. */
                }
              }}
            >
              {locked ? "Release mouse (Esc)" : "Mouse look"}
            </button>
            <div
              className="tour-pad"
              role="group"
              aria-label="Walking controls"
            >
              {controls.map(([label, key]) => (
                <button
                  key={key}
                  aria-label={label}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    keys.current.add(key);
                  }}
                  onPointerUp={() => keys.current.delete(key)}
                  onPointerCancel={() => keys.current.delete(key)}
                  onLostPointerCapture={() => keys.current.delete(key)}
                  onClick={(e) => {
                    if (e.detail === 0 && pose.current) {
                      const p = pose.current;
                      if (key === "ArrowLeft" || key === "ArrowRight")
                        p.yaw += key === "ArrowLeft" ? 0.25 : -0.25;
                      else {
                        const forward =
                            key === "KeyW" ? 1 : key === "KeyS" ? -1 : 0,
                          right = key === "KeyD" ? 1 : key === "KeyA" ? -1 : 0;
                        p.position = moveWalker(
                          nav,
                          p.position,
                          (-Math.sin(p.yaw) * forward +
                            Math.cos(p.yaw) * right) *
                            250,
                          (-Math.cos(p.yaw) * forward -
                            Math.sin(p.yaw) * right) *
                            250,
                        );
                      }
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
