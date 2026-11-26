import * as THREE from "three";

// Small deterministic, local textures: no asset requests and no canvas/DOM dependency.
// Surface maps use metres on architecture; furniture maps follow the mesh UVs.
function texture(
  size: number,
  pixel: (x: number, y: number) => number[],
  color = false,
) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const rgb = pixel(x, y),
        i = (y * size + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = rgb[3] ?? 255;
    }
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;
  return map;
}
const noise = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
export function createTourMaterials() {
  const oak = texture(
    512,
    (x, y) => {
      const row = Math.floor(y / 64),
        offset = (row % 4) * 128;
      const joint = (x + offset) % 512;
      const seam = y % 64 < 1 || joint < 1;
      const grain =
        Math.sin(y * 2.5 + 3 * Math.sin((x * Math.PI) / 256) + row) * 3 +
        Math.sin(y * 0.48 + Math.sin((x * Math.PI) / 128)) * 3 +
        (noise(x, y) - 0.5) * 5;
      const tone = (noise(row, 9) - 0.5) * 20 + grain;
      return seam ? [116, 91, 64] : [190 + tone, 155 + tone, 111 + tone];
    },
    true,
  );
  oak.repeat.set(1 / 2.4, 1 / 1.6); // 2.4 m boards, 20 cm wide.
  const oakRelief = texture(512, (x, y) => {
    const seam = y % 64 < 1 || (x + (Math.floor(y / 64) % 4) * 128) % 512 < 1;
    const v = seam ? 70 : 180 + (noise(x, y) - 0.5) * 16;
    return [v, v, v];
  });
  oakRelief.repeat.copy(oak.repeat);
  const wood = texture(
    256,
    (x, y) => {
      const v =
        Math.sin(y * 1.1 + Math.sin((x * Math.PI) / 128) * 3) * 7 +
        (noise(x, y) - 0.5) * 7;
      return [157 + v, 113 + v, 72 + v];
    },
    true,
  );
  const plaster = texture(128, (x, y) => {
    const v = 160 + noise(x, y) * 60;
    return [v, v, v];
  });
  plaster.repeat.set(4, 4);
  const weave = texture(128, (x, y) => {
    const v =
      165 + (x % 4 < 2 ? 24 : -15) + (y % 4 < 2 ? 18 : -12) + noise(x, y) * 12;
    return [v, v, v];
  });
  weave.repeat.set(6, 6);
  const cloth = (color: string) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.96,
      bumpMap: weave,
      bumpScale: 0.003,
    });
  const shadow = texture(64, (x, y) => {
    const r = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5);
    return [0, 0, 0, Math.pow(Math.max(0, 1 - r), 1.6) * 150];
  });
  shadow.wrapS = shadow.wrapT = THREE.ClampToEdgeWrapping;
  return {
    floor: new THREE.MeshStandardMaterial({
      name: "Natural oak boards",
      map: oak,
      bumpMap: oakRelief,
      bumpScale: 0.0025,
      roughnessMap: oakRelief,
      roughness: 0.68,
      side: THREE.DoubleSide,
    }),
    wall: new THREE.MeshStandardMaterial({
      name: "Warm white plaster",
      color: "#ede9e2",
      bumpMap: plaster,
      bumpScale: 0.0012,
      roughness: 0.92,
      side: THREE.DoubleSide,
    }),
    ceiling: new THREE.MeshStandardMaterial({
      color: "#f4f2ed",
      roughness: 1,
      side: THREE.DoubleSide,
    }),
    trim: new THREE.MeshStandardMaterial({ color: "#f2eee6", roughness: 0.42 }),
    wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.4 }),
    metal: new THREE.MeshStandardMaterial({
      color: "#9c8058",
      roughness: 0.3,
      metalness: 0.85,
    }),
    darkMetal: new THREE.MeshStandardMaterial({
      color: "#282b2b",
      roughness: 0.36,
      metalness: 0.65,
    }),
    upholstery: cloth("#8b9b91"),
    cushion: cloth("#adb9ac"),
    linen: cloth("#e7dfcf"),
    accent: cloth("#b57c57"),
    blanket: cloth("#647b80"),
    seam: cloth("#75877b"),
    contact: new THREE.MeshBasicMaterial({
      map: shadow,
      transparent: true,
      depthWrite: false,
      opacity: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  };
}
export type TourMaterials = ReturnType<typeof createTourMaterials>;
