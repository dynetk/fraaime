// Portable concept data. Dimensions are feet; spacing is inches; rotations are degrees.
export const FORMAT = 'fraaime-public-concept';
export const STORAGE_KEY = 'fraaime-public-editor-v1';
export const TYPES = {
  wall: { label: 'Framed wall panel', width: 12, height: 9, depth: .5 },
  stud: { label: 'Steel stud', width: .125, height: 9, depth: .5 },
  track: { label: 'Steel track', width: 12, height: .125, depth: .5 },
  beam: { label: 'Beam / header', width: 12, height: .75, depth: .5, y: 8.25 },
  post: { label: 'Structural post', width: .5, height: 9, depth: .5 },
  joist: { label: 'Floor joist', width: 16, height: .75, depth: .25, y: 9 },
  slab: { label: 'Floor slab', width: 20, height: .5, depth: 20, y: -.5 },
};
export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = () => crypto.randomUUID();
export function initialState(baseline) {
  return { format: FORMAT, version: 1, units: 'feet', floors: [
    { id: 'main', name: 'Ground floor', elevation: 0 },
  ], components: clone(baseline) };
}
export function makeComponent(type, floor, index = 0) {
  if (!TYPES[type]) throw new Error('Choose a component type.');
  const { label, ...size } = TYPES[type];
  return { id: uid(), sourceId: null, type, name: `${label} ${index + 1}`, floor,
    x: 0, z: 0, y: 0, rotation: 0, spacing: 16, hidden: false, ...size };
}
export function addFloor(state, name, elevation, perimeter = true) {
  if (state.floors.length >= 10) throw new Error('This concept supports up to 10 floors.');
  if (state.components.length + (perimeter ? 5 : 1) > 300) throw new Error('This concept supports up to 300 components.');
  const floor = { id: uid(), name: name.trim(), elevation };
  const slab = { ...makeComponent('slab', floor.id), name: `${name} slab`,
    x: 0, z: 0, width: 20, depth: 20 };
  state.floors.push(floor); state.components.push(slab);
  if (perimeter) for (const [side, x, z, width, rotation] of [
    ['North', 0, -10, 20, 0], ['South', 0, 10, 20, 0],
    ['West', -10, 0, 20, 90], ['East', 10, 0, 20, 90],
  ]) state.components.push({ ...makeComponent('wall', floor.id), name: `${name} · ${side}`, x, z, width, rotation });
  return { floor, slab };
}
export function validateState(value, baseline) {
  const fail = text => { throw new Error(text); };
  if (!value || value.format !== FORMAT || value.version !== 1 || value.units !== 'feet') fail('Choose a public concept JSON exported by this editor (version 1, feet).');
  if (!Array.isArray(value.floors) || value.floors.length < 1 || value.floors.length > 10 || !Array.isArray(value.components) || value.components.length > 300) fail('Unsupported floor or component count.');
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const number = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const ids = new Set(), floors = new Set(), bases = new Map(baseline.map(c => [c.id, c]));
  for (const f of value.floors) {
    if (!text(f.id, 100) || ids.has(f.id) || !text(f.name, 80) || !number(f.elevation, -50, 150)) fail('Invalid floor name, elevation, or duplicate ID.');
    ids.add(f.id); floors.add(f.id);
  }
  for (const [id, elevation] of [['main', 0]]) {
    if (value.floors.find(f => f.id === id)?.elevation !== elevation) fail('The ground-floor datum must stay at zero.');
  }
  for (const c of value.components) {
    if (!text(c.id, 100) || ids.has(c.id) || !Object.hasOwn(TYPES, c.type) || !text(c.name, 80) || !floors.has(c.floor) || typeof c.hidden !== 'boolean') fail('Invalid component, name, floor, or duplicate ID.');
    ids.add(c.id);
    for (const key of ['x', 'z']) if (!number(c[key], -200, 200)) fail('Position must be between -200 and 200 feet.');
    if (!number(c.y, -50, 100) || !number(c.rotation, -360, 360)) fail('Invalid elevation or rotation.');
    for (const key of ['width', 'height', 'depth']) if (!number(c[key], .02, 150)) fail('Dimensions must be between 0.02 and 150 feet.');
    if (!number(c.spacing, 6, 48)) fail('Stud spacing must be between 6 and 48 inches.');
    const base = bases.get(c.id);
    if (base ? c.sourceId !== base.id || c.floor !== base.floor || c.type !== 'wall' : c.sourceId !== null) fail('Source wall identity cannot be changed.');
  }
  // Every source wall remains explicit, including removed walls (hidden=true).
  if (baseline.some(c => !ids.has(c.id))) fail('The file is missing source wall records.');
  const pieces=value.components.reduce((n,c)=>n+(c.hidden||c.sourceId?0:c.type==='wall'?Math.ceil(c.width/(c.spacing/12))+4:1),0);
  if(pieces>6000) fail('This concept is too detailed for the browser viewer. Reduce wall lengths or increase stud spacing.');
  return clone({ format: FORMAT, version: 1, units: 'feet', floors: value.floors, components: value.components });
}
export function createHistory(initial, baseline) {
  let state = validateState(initial, baseline), past = [], future = [];
  return {
    get state() { return clone(state); },
    get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
    commit(next) { const checked = validateState(next, baseline); past.push(state); if (past.length > 50) past.shift(); state = checked; future = []; },
    undo() { if (!past.length) return; future.push(state); state = past.pop(); },
    redo() { if (!future.length) return; past.push(state); state = future.pop(); },
  };
}
