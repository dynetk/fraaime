import * as THREE from 'three';

export function createEditorGeometry(scene, sourceWalls, groups, frameGroups) {
  const additions = new THREE.Group(); scene.add(additions);
  const steel = new THREE.MeshStandardMaterial({color: '#718b87', metalness: .65, roughness: .38});
  const slab = new THREE.MeshStandardMaterial({color: '#c9c5b5', roughness: .9});
  const solid = new THREE.MeshStandardMaterial({color: '#d5dbca', roughness: .8});
  let state, view = 'exterior', representation = 'frame', selection = null, outline;
  const meshes = new Map();
  const baseline = [...sourceWalls].map(([id, v]) => ({id, sourceId: id, type: 'wall',
    name: `${v.level === 'main' ? 'Main' : 'Lower'} · ${v.name.replace(/([A-Z])/g, ' $1').toLowerCase()} wall`,
    floor: v.level, x: v.x, z: v.z, y: 0, width: v.length, height: 9, depth: .45,
    rotation: v.alongX ? 0 : 90, spacing: 16, hidden: false}));
  function clear() {
    for (const g of [...additions.children]) { g.traverse(o => o.geometry?.dispose()); additions.remove(g); }
    meshes.clear();
  }
  function piece(g, x, y, z, w, h, d, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.editorId = g.userData.editorId; g.add(mesh);
  }
  function highlight() {
    if (outline) { scene.remove(outline); outline.geometry.dispose(); outline.material.dispose(); outline = null; }
    const item = state?.components.find(c => c.id === selection && !c.hidden);
    if (!item || (view !== 'exterior' && item.floor !== view)) return;
    const source = sourceWalls.get(item.id);
    const g = source ? (representation === 'frame' ? source.frame : source.architecture) : meshes.get(item.id);
    if (!g) return;
    scene.updateMatrixWorld(true);
    outline = new THREE.BoxHelper(g, '#b37b24'); outline.material.depthTest = false; outline.renderOrder = 10;
    scene.add(outline);
  }
  function sync() {
    if (!state) return;
    const floorY = id => view === 'exterior' ? state.floors.find(f => f.id === id).elevation : 0;
    for (const [id, source] of sourceWalls) {
      const c = state.components.find(c => c.id === id);
      for (const g of [source.frame, source.architecture]) {
        g.visible = !c.hidden; g.position.set(c.x, c.y, c.z);
        g.rotation.y = -(c.rotation - (source.alongX ? 0 : 90)) * Math.PI / 180;
        g.scale.set(source.alongX ? c.width / source.length : c.depth / .45, c.height / 9, source.alongX ? c.depth / .45 : c.width / source.length);
      }
    }
    for (const [id, g] of meshes) {
      const c = state.components.find(c => c.id === id);
      g.visible = !c.hidden && (view === 'exterior' || view === c.floor);
      g.position.set(c.x, floorY(c.floor) + c.y, c.z);
      g.rotation.y = -c.rotation * Math.PI / 180;
      if (c.type === 'wall') { g.children[0].visible = representation === 'architecture'; for (const m of g.children.slice(1)) m.visible = representation === 'frame'; }
    }
    highlight();
  }
  function update(next) {
    state = next; clear();
    for (const c of state.components.filter(c => !c.sourceId && !c.hidden)) build(c);
    sync();
  }
  function build(c) {
      const g = new THREE.Group(); g.userData.editorId = c.id; additions.add(g); meshes.set(c.id, g);
      const {width: w, height: h, depth: d} = c;
      if (c.type === 'wall') {
        piece(g, 0, h / 2, 0, w, h, d, solid);
        const track = Math.min(.09, h / 4), stud = Math.min(.09, w / 4);
        piece(g, 0, track / 2, 0, w, track, d, steel);
        piece(g, 0, h - track / 2, 0, w, track, d, steel);
        for (let x = -w / 2 + stud / 2; x < w / 2 - stud; x += c.spacing / 12) piece(g, x, h / 2, 0, stud, h, d, steel);
        piece(g, w / 2 - stud / 2, h / 2, 0, stud, h, d, steel);
      } else piece(g, 0, h / 2, 0, w, h, d, c.type === 'slab' ? slab : steel);
  }
  return { baseline, update, select(id) { selection = id; highlight(); },
    selectionData() { const c=state?.components.find(c=>c.id===selection&&!c.hidden);return c&&(view==='exterior'||view===c.floor)?{...c,floorElevation:view==='exterior'?state.floors.find(f=>f.id===c.floor).elevation:0}:null; },
    floorElevation(id) { return view==='exterior'?(state?.floors.find(f=>f.id===id)?.elevation??0):0; },
    preview(id,patch) {
      const c=state?.components.find(c=>c.id===id);if(!c)return;
      const rebuild=['width','height','depth','spacing'].some(k=>k in patch&&patch[k]!==c[k]);Object.assign(c,patch);
      if(!c.sourceId&&rebuild){const g=meshes.get(id);if(g){g.traverse(o=>o.geometry?.dispose());additions.remove(g);meshes.delete(id);}build(c);}
      sync();
    },
    sync(v, r) { view = v; representation = r; sync(); },
    selectionPosition() { if (!state) return null; const c = state.components.find(c => c.id === selection); if (!c) return null; return {x: c.x, z: c.z, y: c.y + (view === 'exterior' ? state.floors.find(f => f.id === c.floor).elevation : 0)}; },
    topElevation() { return state ? Math.max(20, ...state.components.filter(c => !c.hidden && (view === 'exterior' || c.floor === view)).map(c => c.y + c.height + (view === 'exterior' ? state.floors.find(f => f.id === c.floor).elevation : 0))) : 20; },
    dispose() { clear(); if (outline) { outline.geometry.dispose(); outline.material.dispose(); } steel.dispose(); slab.dispose(); solid.dispose(); },
  };
}
