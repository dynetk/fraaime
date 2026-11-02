const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const snap = (n, step) => step ? Math.round(n / step) * step : n;
export function movePatch(component, dx, dz, step = .5) {
  return {x: clamp(snap(component.x + dx, step), -200, 200), z: clamp(snap(component.z + dz, step), -200, 200)};
}
// Resize from one end; the opposite end stays anchored, even for rotated parts.
export function resizePatch(component, axis, sign, distance, step = .5) {
  const key = axis === 'length' ? 'width' : 'depth';
  const angle = (component.rotation + (axis === 'depth' ? 90 : 0)) * Math.PI / 180;
  const size = clamp(snap(component[key] + sign * distance, step), .02, 150);
  const shift = sign * (size - component[key]) / 2;
  return {[key]: size, x: component.x + Math.cos(angle) * shift, z: component.z + Math.sin(angle) * shift};
}
export function heightPatch(component, delta, step = .5) {
  return {height: clamp(snap(component.height + delta, step), .02, 150)};
}
export function rotationPatch(component, startAngle, angle, step = 15) {
  const delta = Math.atan2(Math.sin(angle - startAngle), Math.cos(angle - startAngle));
  const degrees = snap(component.rotation + delta * 180 / Math.PI, step);
  return {rotation: ((degrees + 180) % 360 + 360) % 360 - 180};
}
