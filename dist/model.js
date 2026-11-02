import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createEditorGeometry } from './editor-geometry.js';
import { createManipulator } from './model-manipulator.js';

// Blank scene: no customer drawing, address, schedule or building geometry.
export function createModel(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#efeee8');
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 1500);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 3;
  controls.maxDistance = 600;
  scene.add(new THREE.HemisphereLight('#ffffff', '#8d8a75', 2.5));
  const light = new THREE.DirectionalLight('#ffffff', 3);
  light.position.set(30, 50, 20);
  scene.add(light);
  const grid = new THREE.GridHelper(100, 100, '#a6aa93', '#d5d5c9');
  grid.position.y = -.01;
  scene.add(grid);
  const geometry = createEditorGeometry(scene, new Map(), {}, {});
  let view = 'exterior', look = 'frame', editing = false, placing = false;
  let select = () => {}, move = () => {}, transform = () => {}, preview = () => {}, drop = () => {}, viewChanged = () => {};
  function pick(ray) {
    return ray.intersectObjects(scene.children, true).find(hit => {
      if (!hit.object.isMesh || !hit.object.userData.editorId || hit.object.userData.editorHelper) return false;
      for (let object = hit.object; object; object = object.parent) if (!object.visible) return false;
      return true;
    });
  }
  const manipulator = createManipulator({ container, scene, camera, controls, geometry, pick,
    onSelect: id => select(id), onCommit: (id, patch) => transform(id, patch),
    onPreview: patch => preview(patch), onDrop: (...args) => drop(...args) });
  const resize = new ResizeObserver(() => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });
  resize.observe(container);
  function home() {
    manipulator.cancel();
    const height = geometry.topElevation();
    controls.target.set(0, Math.max(3, height / 4), 0);
    camera.position.set(40, Math.max(32, height + 18), 48); controls.update();
  }
  let down = null;
  container.addEventListener('pointerdown', event => { down = [event.clientX, event.clientY]; });
  container.addEventListener('pointerup', event => {
    if (!editing || !placing || !down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
    const selected = geometry.selectionData(); if (!selected) return;
    const rect = container.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
    const point = new THREE.Vector3();
    if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -geometry.floorElevation(selected.floor)), point)) move(point.x, point.z);
  });
  renderer.setAnimationLoop(() => { controls.update(); manipulator.update(); renderer.render(scene, camera); });
  home();
  return {
    getBaseline: () => [],
    updateEdits(state) { geometry.update(state); geometry.sync(view, look); },
    selectEdit(id) { geometry.select(id); },
    setEditMode(value) { editing = value; manipulator.setEnabled(editing && !placing); },
    setPlacement(value) { placing = value; manipulator.setEnabled(editing && !placing); },
    setView(value) { manipulator.cancel(); view = value; geometry.sync(view, look); viewChanged(view); },
    setRepresentation(value) { look = value; geometry.sync(view, look); },
    setEditTool: value => manipulator.setMode(value), setEditSnap: value => manipulator.setSnap(value),
    setDropFloor: value => manipulator.setDropFloor(value), setLibraryDrag: value => manipulator.setDragType(value),
    onViewChange(fn) { viewChanged = fn; }, onEditSelect(fn) { select = fn; }, onEditMove(fn) { move = fn; },
    onEditTransform(fn) { transform = fn; }, onEditPreview(fn) { preview = fn; }, onComponentDrop(fn) { drop = fn; },
    home,
    top() { manipulator.cancel(); controls.target.set(0, 0, 0); camera.position.set(0, geometry.topElevation() + 65, .01); controls.update(); },
    zoom(factor) { camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update(); },
    focusEdit() { const point = geometry.selectionPosition(); if (point) { controls.target.set(point.x, point.y + 4, point.z); camera.position.set(point.x + 18, point.y + 18, point.z + 22); controls.update(); } },
    dispose() { resize.disconnect(); renderer.setAnimationLoop(null); manipulator.dispose(); geometry.dispose(); controls.dispose(); renderer.dispose(); }
  };
}
