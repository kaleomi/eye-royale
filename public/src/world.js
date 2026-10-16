// 岛屿世界：地形、城镇、建筑、植被、碰撞体与视线检测
import * as THREE from 'three';
import { MAP_HALF, GRID, WATER_LEVEL, TOWN_NAMES } from './config.js';
import { makeNoise, fbm, smoothstep, mulberry32, lerp, clamp, shuffle } from './util.js';

export const W = {
  heights: null,
  towns: [],
  buildings: [],
  obstacles: [],
  lootSpots: [],
  trees: [],
  mapCanvas: null,
  smokeTest: null,
  seed: 1,
};

const N = GRID;
const ROW = N + 1;
const STEP = (MAP_HALF * 2) / N;
const CELL = 20;
const CELLS = Math.ceil((MAP_HALF * 2) / CELL) + 2;
const cells = new Array(CELLS * CELLS);
let stamp = 1;

let noiseA, noiseB, noiseC, noiseD;

function rawHeight(x, z) {
  const d = Math.hypot(x, z * 1.08);
  const coast = 505 + 70 * noiseA(x * 0.003 + 7.3, z * 0.003 - 2.1);
  const land = smoothstep(coast + 50, coast - 70, d);
  let h = 10 + fbm(noiseB, x * 0.0028, z * 0.0028, 5) * 30;
  h += Math.max(0, fbm(noiseC, x * 0.0016 + 3, z * 0.0016, 3)) * 40;
  return h * land - (1 - land) * 20;
}

export function heightAt(x, z) {
  let gx = (x + MAP_HALF) / STEP, gz = (z + MAP_HALF) / STEP;
  if (gx < 0) gx = 0; else if (gx > N - 1e-4) gx = N - 1e-4;
  if (gz < 0) gz = 0; else if (gz > N - 1e-4) gz = N - 1e-4;
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz;
  const H = W.heights;
  const h00 = H[iz * ROW + ix], h10 = H[iz * ROW + ix + 1];
  const h01 = H[(iz + 1) * ROW + ix], h11 = H[(iz + 1) * ROW + ix + 1];
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

export function isLand(x, z, minH = 1) { return heightAt(x, z) > minH; }

// ---------- 碰撞体网格 ----------
function cellIndex(ix, iz) { return iz * CELLS + ix; }
function toCell(v) { return clamp(Math.floor((v + MAP_HALF) / CELL) + 1, 0, CELLS - 1); }

function addObstacle(o) {
  W.obstacles.push(o);
  o._s = 0;
  let minX, maxX, minZ, maxZ;
  if (o.t === 0) { minX = o.minX; maxX = o.maxX; minZ = o.minZ; maxZ = o.maxZ; }
  else { minX = o.x - o.r; maxX = o.x + o.r; minZ = o.z - o.r; maxZ = o.z + o.r; }
  for (let ix = toCell(minX); ix <= toCell(maxX); ix++)
    for (let iz = toCell(minZ); iz <= toCell(maxZ); iz++) {
      const k = cellIndex(ix, iz);
      (cells[k] || (cells[k] = [])).push(o);
    }
  return o;
}

export function forEachNear(minX, minZ, maxX, maxZ, fn) {
  stamp++;
  const x0 = toCell(minX), x1 = toCell(maxX), z0 = toCell(minZ), z1 = toCell(maxZ);
  for (let ix = x0; ix <= x1; ix++)
    for (let iz = z0; iz <= z1; iz++) {
      const list = cells[cellIndex(ix, iz)];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o._s === stamp) continue;
        o._s = stamp;
        if (fn(o) === true) return true;
      }
    }
  return false;
}

// ---------- 视线检测 ----------
function segBox(o, ax, ay, az, dx, dy, dz) {
  let t0 = 0.002, t1 = 0.995;
  if (Math.abs(dx) < 1e-9) { if (ax < o.minX || ax > o.maxX) return false; }
  else {
    let ta = (o.minX - ax) / dx, tb = (o.maxX - ax) / dx;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return false;
  }
  if (Math.abs(dy) < 1e-9) { if (ay < o.minY || ay > o.maxY) return false; }
  else {
    let ta = (o.minY - ay) / dy, tb = (o.maxY - ay) / dy;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az < o.minZ || az > o.maxZ) return false; }
  else {
    let ta = (o.minZ - az) / dz, tb = (o.maxZ - az) / dz;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return false;
  }
  return true;
}

export function segSphere(cx, cy, cz, r, ax, ay, az, dx, dy, dz, ignoreStartInside = true) {
  const sx = ax - cx, sy = ay - cy, sz = az - cz;
  if (ignoreStartInside && sx * sx + sy * sy + sz * sz < r * r) return false;
  const l2 = dx * dx + dy * dy + dz * dz;
  if (l2 < 1e-9) return false;
  const t = clamp(-(sx * dx + sy * dy + sz * dz) / l2, 0, 1);
  const px = sx + dx * t, py = sy + dy * t, pz = sz + dz * t;
  return px * px + py * py + pz * pz < r * r;
}

function segCyl(o, ax, ay, az, dx, dy, dz) {
  const sx = ax - o.x, sz = az - o.z;
  if (sx * sx + sz * sz < o.r * o.r) return false;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) return false;
  const t = clamp(-(sx * dx + sz * dz) / l2, 0, 1);
  const px = sx + dx * t, pz = sz + dz * t;
  if (px * px + pz * pz >= o.r * o.r) return false;
  const y = ay + dy * t;
  return y >= o.y0 && y <= o.y1;
}

// a -> b 之间是否被地形 / 建筑 / 树 / 石头 / 草丛 / 烟雾 遮挡
export function segBlocked(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.05) return false;
  const n = Math.ceil(len / 2.5);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
    if (y < heightAt(x, z) + 0.05) return true;
  }
  if (W.smokeTest && W.smokeTest(ax, ay, az, dx, dy, dz)) return true;
  stamp++;
  const hl = Math.hypot(dx, dz);
  const steps = Math.ceil(hl / (CELL * 0.35)) + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const k = cellIndex(toCell(ax + dx * t), toCell(az + dz * t));
    const list = cells[k];
    if (!list) continue;
    for (let j = 0; j < list.length; j++) {
      const o = list[j];
      if (o._s === stamp) continue;
      o._s = stamp;
      if (o.t === 0) { if (segBox(o, ax, ay, az, dx, dy, dz)) return true; }
      else if (o.t === 1) { if (segCyl(o, ax, ay, az, dx, dy, dz)) return true; }
      else if (segSphere(o.x, o.y, o.z, o.r, ax, ay, az, dx, dy, dz)) return true;
    }
  }
  return false;
}

export function buildingAt(x, z, margin = 0.2) {
  for (const b of W.buildings) {
    if (x > b.inMinX - margin && x < b.inMaxX + margin && z > b.inMinZ - margin && z < b.inMaxZ + margin) return b;
  }
  return null;
}

// ---------- 合并几何体 ----------
class MeshBuilder {
  constructor() { this.p = []; this.n = []; this.c = []; }
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, col) {
    const P = this.p, Nn = this.n, C = this.c;
    P.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
    for (let i = 0; i < 6; i++) { Nn.push(nx, ny, nz); C.push(col.r, col.g, col.b); }
  }
  box(cx, cy, cz, sx, sy, sz, col) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, col);
    this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, col);
    this.quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, col);
    this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, col);
    this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, col);
    this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, col);
  }
  geo(g, matrix, col) {
    const ng = g.index ? g.toNonIndexed() : g.clone();
    ng.applyMatrix4(matrix);
    ng.computeVertexNormals();
    const pa = ng.attributes.position.array, na = ng.attributes.normal.array;
    for (let i = 0; i < pa.length; i++) { this.p.push(pa[i]); this.n.push(na[i]); }
    for (let i = 0; i < pa.length / 3; i++) this.c.push(col.r, col.g, col.b);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- 建筑 ----------
const BTYPES = {
  house: { w: 10, d: 8, H: 3.2, doors: [['front', 1.6, 2.3]], loot: [2, 4], roof: 1.7 },
  long:  { w: 15, d: 7, H: 3.4, doors: [['front', 1.6, 2.3], ['right', 1.6, 2.3]], loot: [3, 4], roof: 1.6 },
  ware:  { w: 20, d: 13, H: 6, doors: [['front', 3.2, 4], ['back', 3.2, 4]], loot: [4, 6], roof: 0 },
  shed:  { w: 5, d: 5, H: 2.8, doors: [['front', 1.4, 2.2]], loot: [1, 2], roof: 1.2 },
};
const WALL_COLS = ['#c9b79c', '#b8a68e', '#a3786a', '#9fa8a3', '#d6cdb8', '#8c6f5a', '#b9c2b0', '#c7a98b'];
const ROOF_COLS = ['#7a3b2e', '#4a5560', '#5b4636', '#3d4d3a', '#6b2f2f'];

function rot(k, x, z) {
  switch (k & 3) {
    case 0: return [x, z];
    case 1: return [z, -x];
    case 2: return [-x, -z];
    default: return [-z, x];
  }
}

function buildBuilding(b, mb, rng) {
  const T = BTYPES[b.type];
  const { w, d, H } = T, t = 0.3;
  const k = b.k;
  // 地板高度
  let fy = -1e9;
  const [hw, hd] = (k & 1) ? [d / 2, w / 2] : [w / 2, d / 2];
  for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) fy = Math.max(fy, heightAt(b.x + ox, b.z + oz));
  fy += 0.12;
  b.floorY = fy;
  const wallCol = new THREE.Color(b.type === 'ware' ? '#8a9096' : WALL_COLS[Math.floor(rng() * WALL_COLS.length)]);
  const roofCol = new THREE.Color(b.type === 'ware' ? '#5c6166' : ROOF_COLS[Math.floor(rng() * ROOF_COLS.length)]);
  const floorCol = new THREE.Color('#6e5d4b');
  const winCol = new THREE.Color('#26313d');
  const frameCol = wallCol.clone().multiplyScalar(0.7);

  const local = (lx, ly, lz, sx, sy, sz, col, collide = true) => {
    const [rx, rz] = rot(k, lx, lz);
    const [wsx, wsz] = (k & 1) ? [sz, sx] : [sx, sz];
    const cx = b.x + rx, cy = fy + ly, cz = b.z + rz;
    mb.box(cx, cy, cz, wsx, sy, wsz, col);
    if (collide) addObstacle({ t: 0, minX: cx - wsx / 2, maxX: cx + wsx / 2, minY: cy - sy / 2, maxY: cy + sy / 2, minZ: cz - wsz / 2, maxZ: cz + wsz / 2 });
  };
  const doorOf = side => T.doors.find(dd => dd[0] === side);
  const wallBottom = -1.4, wallH = H - wallBottom, wallCy = (H + wallBottom) / 2;
  // 沿 x 方向的墙（front/back）
  const wallX = (side, z0) => {
    const door = doorOf(side);
    if (!door) { local(0, wallCy, z0, w, wallH, t, wallCol); return; }
    const dw = door[1], dh = door[2];
    const segW = (w - dw) / 2;
    local(-(dw / 2 + segW / 2), wallCy, z0, segW, wallH, t, wallCol);
    local((dw / 2 + segW / 2), wallCy, z0, segW, wallH, t, wallCol);
    local(0, (dh + H) / 2, z0, dw, H - dh, t, wallCol);
    local(-dw / 2 - 0.08, dh / 2, z0, 0.16, dh, t + 0.06, frameCol, false);
    local(dw / 2 + 0.08, dh / 2, z0, 0.16, dh, t + 0.06, frameCol, false);
  };
  const wallZ = (side, x0) => {
    const door = doorOf(side);
    const span = d - 2 * t;
    if (!door) { local(x0, wallCy, 0, t, wallH, span, wallCol); return; }
    const dw = door[1], dh = door[2];
    const segW = (span - dw) / 2;
    local(x0, wallCy, -(dw / 2 + segW / 2), t, wallH, segW, wallCol);
    local(x0, wallCy, (dw / 2 + segW / 2), t, wallH, segW, wallCol);
    local(x0, (dh + H) / 2, 0, t, H - dh, dw, wallCol);
  };
  wallX('front', d / 2 - t / 2);
  wallX('back', -d / 2 + t / 2);
  wallZ('left', -w / 2 + t / 2);
  wallZ('right', w / 2 - t / 2);
  // 地板与屋顶
  local(0, -0.75, 0, w, 1.5, d, floorCol);
  local(0, H + 0.12, 0, w + 0.5, 0.24, d + 0.5, roofCol);
  // 窗户（装饰）
  if (b.type !== 'ware') {
    const wy = Math.min(1.65, H - 0.9);
    if (!doorOf('back')) for (const xx of [-w / 4, w / 4]) local(xx, wy, -d / 2 - 0.03, 1.0, 0.9, 0.08, winCol, false);
    if (!doorOf('left')) local(-w / 2 - 0.03, wy, 0, 0.08, 0.9, 1.0, winCol, false);
    if (!doorOf('right')) local(w / 2 + 0.03, wy, 0, 0.08, 0.9, 1.0, winCol, false);
    for (const xx of [-w / 2 + 1.6, w / 2 - 1.6]) if (Math.abs(xx) > 1.6) local(xx, wy, d / 2 + 0.03, 0.9, 0.9, 0.08, winCol, false);
  } else {
    for (const xx of [-w / 3, 0, w / 3]) local(xx, H - 1.0, -d / 2 - 0.03, 2.0, 0.7, 0.08, winCol, false);
  }
  // 斜屋顶
  if (T.roof > 0) {
    const cone = new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4);
    const [sx, sz] = (k & 1) ? [d / 2 + 0.35, w / 2 + 0.35] : [w / 2 + 0.35, d / 2 + 0.35];
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(b.x, fy + H + 0.24 + T.roof / 2, b.z),
      new THREE.Quaternion(),
      new THREE.Vector3(sx / 0.7071, T.roof, sz / 0.7071));
    mb.geo(cone, m, roofCol);
  }
  // 室内范围
  const c1 = rot(k, -w / 2 + t, -d / 2 + t), c2 = rot(k, w / 2 - t, d / 2 - t);
  b.inMinX = b.x + Math.min(c1[0], c2[0]); b.inMaxX = b.x + Math.max(c1[0], c2[0]);
  b.inMinZ = b.z + Math.min(c1[1], c2[1]); b.inMaxZ = b.z + Math.max(c1[1], c2[1]);
  // 门（AI 寻路用）
  b.doors = T.doors.map(([side]) => {
    let o, i;
    if (side === 'front') { o = [0, d / 2 + 1.8]; i = [0, d / 2 - 1.6]; }
    else if (side === 'back') { o = [0, -d / 2 - 1.8]; i = [0, -d / 2 + 1.6]; }
    else if (side === 'right') { o = [w / 2 + 1.8, 0]; i = [w / 2 - 1.6, 0]; }
    else { o = [-w / 2 - 1.8, 0]; i = [-w / 2 + 1.6, 0]; }
    const ro = rot(k, o[0], o[1]), ri = rot(k, i[0], i[1]);
    return { out: { x: b.x + ro[0], z: b.z + ro[1] }, in: { x: b.x + ri[0], z: b.z + ri[1] } };
  });
  // 物资点
  const nLoot = T.loot[0] + Math.floor(rng() * (T.loot[1] - T.loot[0] + 1));
  for (let i = 0; i < nLoot; i++) {
    const lx = (rng() - 0.5) * (w - 2 * t - 2), lz = (rng() - 0.5) * (d - 2 * t - 2);
    const [rx, rz] = rot(k, lx, lz);
    W.lootSpots.push({ x: b.x + rx, z: b.z + rz, y: fy, indoor: true });
  }
}

// ---------- 主构建 ----------
export function buildWorld(scene, seed = (Math.random() * 1e9) | 0) {
  W.seed = seed;
  const rng = mulberry32(seed);
  noiseA = makeNoise(seed + 11); noiseB = makeNoise(seed + 23); noiseC = makeNoise(seed + 37); noiseD = makeNoise(seed + 51);
  W.towns = []; W.buildings = []; W.obstacles = []; W.lootSpots = []; W.trees = [];
  cells.fill(undefined);

  // 0. 训练靶场：一条约 230 米长、48 米宽的平地
  let bestR = null, bestScore = -1e9;
  for (let tries = 0; tries < 500; tries++) {
    const x = (rng() - 0.5) * 760, zF = (rng() - 0.5) * 640 + 110;
    let land = 0, n = 0, sum = 0, mn = 1e9, mx = -1e9;
    for (let t = -14; t <= 222; t += 16) for (const ox of [-24, 0, 24]) {
      const h = rawHeight(x + ox, zF - t); n++;
      if (h > 3) land++;
      sum += h; mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    const score = land / n - Math.max(0, mx - mn - 18) * 0.01;
    if (score > bestScore) { bestScore = score; bestR = { x, zF, base: Math.max(4, sum / n) }; }
    if (land === n && mx - mn < 18) break;
  }
  W.range = { x: bestR.x, zF: bestR.zF, base: bestR.base, hw: 24, z0: bestR.zF + 14, z1: bestR.zF - 222, name: '训练靶场' };
  const RG = W.range;
  const rangeDist = (x, z) => {
    const cz = (RG.z0 + RG.z1) / 2, hd = (RG.z0 - RG.z1) / 2;
    return Math.hypot(Math.max(Math.abs(x - RG.x) - RG.hw, 0), Math.max(Math.abs(z - cz) - hd, 0));
  };
  W.rangeDist = rangeDist;

  // 1. 城镇
  const names = shuffle(TOWN_NAMES.slice());
  for (let tries = 0; tries < 600 && W.towns.length < 9; tries++) {
    const x = (rng() - 0.5) * 860, z = (rng() - 0.5) * 860;
    const h = rawHeight(x, z);
    if (h < 3 || h > 42) continue;
    let ok = true;
    for (const [ox, oz] of [[35, 0], [-35, 0], [0, 35], [0, -35]]) if (rawHeight(x + ox, z + oz) < 1.5) ok = false;
    for (const t of W.towns) if (Math.hypot(t.x - x, t.z - z) < 175) ok = false;
    if (rangeDist(x, z) < 120) ok = false;
    if (!ok) continue;
    W.towns.push({ x, z, r: 42 + rng() * 30, base: Math.max(2.5, h), name: names[W.towns.length % names.length] });
  }
  // 2. 建筑位置（2D）
  const placed = [{ x: RG.x, z: (RG.z0 + RG.z1) / 2, hw: RG.hw + 2, hd: (RG.z0 - RG.z1) / 2 + 2 }];
  const fits = (x, z, hw, hd, margin) => {
    for (const p of placed) if (Math.abs(p.x - x) < p.hw + hw + margin && Math.abs(p.z - z) < p.hd + hd + margin) return false;
    return true;
  };
  const place = (x, z, type, k, town) => {
    const T = BTYPES[type];
    const [hw, hd] = (k & 1) ? [T.d / 2, T.w / 2] : [T.w / 2, T.d / 2];
    if (!fits(x, z, hw, hd, 5)) return false;
    placed.push({ x, z, hw, hd, type, k, town });
    return true;
  };
  for (const t of W.towns) {
    const target = 6 + Math.floor(t.r / 7);
    let n = 0;
    for (let tries = 0; tries < 200 && n < target; tries++) {
      const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * (t.r - 8);
      const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
      const roll = rng();
      const type = roll < 0.45 ? 'house' : roll < 0.65 ? 'long' : roll < 0.82 ? 'shed' : 'ware';
      if (place(x, z, type, Math.floor(rng() * 4), t)) n++;
    }
  }
  for (let tries = 0, n = 0; tries < 400 && n < 34; tries++) {
    const x = (rng() - 0.5) * 920, z = (rng() - 0.5) * 920;
    const h = rawHeight(x, z);
    if (h < 3 || h > 50) continue;
    let near = false;
    for (const t of W.towns) if (Math.hypot(t.x - x, t.z - z) < t.r + 40) near = true;
    if (near) continue;
    if (place(x, z, rng() < 0.6 ? 'shed' : 'house', Math.floor(rng() * 4), null)) n++;
  }
  // 3. 高度图（含城镇/建筑压平）
  const H = new Float32Array(ROW * ROW);
  const flat = placed.filter(p => p.type && !p.town).map(p => ({ x: p.x, z: p.z, base: Math.max(2, rawHeight(p.x, p.z)), r: Math.max(p.hw, p.hd) + 3 }));
  for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) {
    const x = -MAP_HALF + ix * STEP, z = -MAP_HALF + iz * STEP;
    let h = rawHeight(x, z);
    for (const t of W.towns) {
      const dd = Math.hypot(x - t.x, z - t.z);
      if (dd < t.r + 40) h = lerp(h, t.base, smoothstep(t.r + 40, t.r + 4, dd));
    }
    for (const f of flat) {
      const dd = Math.hypot(x - f.x, z - f.z);
      if (dd < f.r + 10) h = lerp(h, f.base, smoothstep(f.r + 10, f.r, dd));
    }
    const rd = rangeDist(x, z);
    if (rd < 34) h = lerp(h, RG.base, smoothstep(34, 3, rd));
    H[iz * ROW + ix] = h;
  }
  W.heights = H;

  // 4. 地形网格
  const pos = new Float32Array(ROW * ROW * 3);
  for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) {
    const i = iz * ROW + ix;
    pos[i * 3] = -MAP_HALF + ix * STEP; pos[i * 3 + 1] = H[i]; pos[i * 3 + 2] = -MAP_HALF + iz * STEP;
  }
  const idx = [];
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    const v00 = iz * ROW + ix, v10 = v00 + 1, v01 = v00 + ROW, v11 = v01 + 1;
    idx.push(v00, v01, v10, v10, v01, v11);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const nrm = tg.attributes.normal.array;
  const col = new Float32Array(ROW * ROW * 3);
  const cSand = new THREE.Color('#d9c690'), cGrass1 = new THREE.Color('#5f8d3c'), cGrass2 = new THREE.Color('#86a94c');
  const cRock = new THREE.Color('#7f776b'), cHigh = new THREE.Color('#8e9a6e'), cDirt = new THREE.Color('#9a8763'), cSea = new THREE.Color('#b7a777'), cRange = new THREE.Color('#b0a582');
  const cc = new THREE.Color();
  for (let i = 0; i < ROW * ROW; i++) {
    const x = pos[i * 3], h = pos[i * 3 + 1], z = pos[i * 3 + 2], ny = nrm[i * 3 + 1];
    const n = noiseD(x * 0.02, z * 0.02) * 0.5 + 0.5;
    cc.copy(cGrass1).lerp(cGrass2, n);
    if (h > 34) cc.lerp(cHigh, smoothstep(34, 50, h));
    let town = 0;
    for (const t of W.towns) town = Math.max(town, smoothstep(t.r + 12, t.r - 10, Math.hypot(x - t.x, z - t.z)));
    if (town > 0) cc.lerp(cDirt, town * 0.75);
    if (ny < 0.86) cc.lerp(cRock, smoothstep(0.86, 0.7, ny));
    if (h < 2.6) cc.lerp(cSand, smoothstep(2.6, 1.0, h));
    const rdc = rangeDist(x, z);
    if (rdc < 8) cc.lerp(cRange, rdc <= 0 ? 0.85 : smoothstep(8, 0, rdc) * 0.85);
    if (h < -0.5) cc.copy(cSea);
    col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.name = 'terrain';
  scene.add(terrain);

  // 水面
  const water = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x2f7aa6, transparent: true, opacity: 0.86 }));
  water.position.y = WATER_LEVEL;
  water.name = 'water';
  scene.add(water);

  // 5. 建筑
  const mb = new MeshBuilder();
  for (const p of placed) {
    if (!p.type) continue;
    const b = { x: p.x, z: p.z, type: p.type, k: p.k, town: p.town };
    buildBuilding(b, mb, rng);
    W.buildings.push(b);
  }
  // 掩体：矮墙与箱子
  const concrete = new THREE.Color('#9b9a92'), crateCol = new THREE.Color('#8a6a3e'), crateCol2 = new THREE.Color('#6d5733');
  const blocked = (x, z, m) => {
    for (const p of placed) if (Math.abs(p.x - x) < p.hw + m && Math.abs(p.z - z) < p.hd + m) return true;
    return false;
  };
  for (const t of W.towns) {
    for (let i = 0, n = 0; i < 40 && n < 7; i++) {
      const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * t.r;
      const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
      const len = 5 + rng() * 7, alongX = rng() < 0.5;
      const sx = alongX ? len : 0.35, sz = alongX ? 0.35 : len;
      if (blocked(x, z, Math.max(sx, sz) / 2 + 2)) continue;
      const h0 = Math.max(heightAt(x - sx / 2, z - sz / 2), heightAt(x + sx / 2, z + sz / 2), heightAt(x, z));
      const y0 = h0 - 1.0, y1 = h0 + 1.35;
      mb.box(x, (y0 + y1) / 2, z, sx, y1 - y0, sz, concrete);
      addObstacle({ t: 0, minX: x - sx / 2, maxX: x + sx / 2, minY: y0, maxY: y1, minZ: z - sz / 2, maxZ: z + sz / 2 });
      n++;
    }
    for (let i = 0, n = 0; i < 40 && n < 9; i++) {
      const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * t.r;
      const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
      if (blocked(x, z, 2.5)) continue;
      const s = 1.3 + rng() * 0.3, h0 = heightAt(x, z);
      mb.box(x, h0 + s / 2 - 0.2, z, s, s, s, crateCol);
      addObstacle({ t: 0, minX: x - s / 2, maxX: x + s / 2, minY: h0 - 0.5, maxY: h0 + s - 0.2, minZ: z - s / 2, maxZ: z + s / 2 });
      if (rng() < 0.35) {
        const s2 = s * 0.85;
        mb.box(x, h0 + s - 0.2 + s2 / 2, z, s2, s2, s2, crateCol2);
        addObstacle({ t: 0, minX: x - s2 / 2, maxX: x + s2 / 2, minY: h0 + s - 0.2, maxY: h0 + s - 0.2 + s2, minZ: z - s2 / 2, maxZ: z + s2 / 2 });
      }
      placed.push({ x, z, hw: s / 2, hd: s / 2 });
      n++;
    }
  }
  buildRangeDecor(scene, mb);
  const bmesh = new THREE.Mesh(mb.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  bmesh.name = 'buildings';
  scene.add(bmesh);

  // 6. 植被
  const nearTownOrBuilding = (x, z, m) => {
    for (const t of W.towns) if (Math.hypot(t.x - x, t.z - z) < t.r + m) return true;
    return blocked(x, z, m * 0.5 + 2);
  };
  const treesPine = [], treesRound = [], bushes = [], rocks = [];
  for (let i = 0; i < 9000 && treesPine.length + treesRound.length < 1700; i++) {
    const x = (rng() - 0.5) * 1150, z = (rng() - 0.5) * 1150;
    const h = heightAt(x, z);
    if (h < 2.2) continue;
    const forest = noiseA(x * 0.007 + 40, z * 0.007 - 13);
    if (rng() > (forest > 0.15 ? 0.85 : 0.05)) continue;
    if (nearTownOrBuilding(x, z, 6)) continue;
    const pine = h > 26 ? rng() < 0.8 : rng() < 0.45;
    const tr = { x, z, h, s: 0.8 + rng() * 0.6, pine };
    (pine ? treesPine : treesRound).push(tr);
  }
  for (let i = 0; i < 5000 && bushes.length < 950; i++) {
    const x = (rng() - 0.5) * 1150, z = (rng() - 0.5) * 1150;
    const h = heightAt(x, z);
    if (h < 1.8) continue;
    if (blocked(x, z, 2.5)) continue;
    bushes.push({ x, z, h, s: 0.8 + rng() * 0.45 });
  }
  for (let i = 0; i < 3000 && rocks.length < 280; i++) {
    const x = (rng() - 0.5) * 1150, z = (rng() - 0.5) * 1150;
    const h = heightAt(x, z);
    if (h < 0.5) continue;
    if (nearTownOrBuilding(x, z, 4)) continue;
    rocks.push({ x, z, h, s: 0.9 + rng() * 2.2, ry: rng() * 6.28 });
  }
  const dummy = new THREE.Object3D();
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.32, 1, 6).translate(0, 0.5, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  const allTrees = treesPine.concat(treesRound);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, allTrees.length);
  allTrees.forEach((t, i) => {
    const th = (t.pine ? 2.2 : 3.0) * t.s;
    dummy.position.set(t.x, t.h - 0.3, t.z); dummy.scale.set(t.s, th + 0.3, t.s); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    addObstacle({ t: 1, x: t.x, z: t.z, r: 0.35 * t.s, y0: t.h - 1, y1: t.h + th + 0.5 });
    if (t.pine) addObstacle({ t: 2, x: t.x, y: t.h + th + 2.6 * t.s, z: t.z, r: 1.9 * t.s });
    else addObstacle({ t: 2, x: t.x, y: t.h + th + 1.6 * t.s, z: t.z, r: 2.3 * t.s });
    W.trees.push(t);
  });
  scene.add(trunks);
  const pineGeo = new THREE.ConeGeometry(2.1, 6, 7).translate(0, 3, 0);
  const roundGeo = new THREE.IcosahedronGeometry(2.4, 0);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const pines = new THREE.InstancedMesh(pineGeo, leafMat, Math.max(1, treesPine.length));
  const rounds = new THREE.InstancedMesh(roundGeo, leafMat, Math.max(1, treesRound.length));
  const lc = new THREE.Color();
  pines.count = treesPine.length; rounds.count = treesRound.length;
  treesPine.forEach((t, i) => {
    dummy.position.set(t.x, t.h + 2.2 * t.s - 0.2, t.z); dummy.scale.set(t.s, t.s, t.s); dummy.rotation.set(0, rng() * 6, 0); dummy.updateMatrix();
    pines.setMatrixAt(i, dummy.matrix);
    pines.setColorAt(i, lc.setHSL(0.30 + rng() * 0.05, 0.42, 0.22 + rng() * 0.08));
  });
  treesRound.forEach((t, i) => {
    dummy.position.set(t.x, t.h + 3.0 * t.s + 1.6 * t.s, t.z); dummy.scale.set(t.s, t.s * 0.9, t.s); dummy.rotation.set(rng(), rng() * 6, rng()); dummy.updateMatrix();
    rounds.setMatrixAt(i, dummy.matrix);
    rounds.setColorAt(i, lc.setHSL(0.22 + rng() * 0.08, 0.45, 0.30 + rng() * 0.1));
  });
  scene.add(pines, rounds);

  const bushGeo = new THREE.IcosahedronGeometry(1, 1);
  const bushMesh = new THREE.InstancedMesh(bushGeo, leafMat, bushes.length);
  bushes.forEach((b, i) => {
    dummy.position.set(b.x, b.h + b.s * 0.45, b.z); dummy.scale.set(b.s * 1.15, b.s * 0.85, b.s * 1.15); dummy.rotation.set(0, rng() * 6, 0); dummy.updateMatrix();
    bushMesh.setMatrixAt(i, dummy.matrix);
    bushMesh.setColorAt(i, lc.setHSL(0.24 + rng() * 0.06, 0.5, 0.26 + rng() * 0.08));
    addObstacle({ t: 2, x: b.x, y: b.h + b.s * 0.45, z: b.z, r: b.s * 1.0 });
  });
  scene.add(bushMesh);

  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMesh = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), rocks.length);
  rocks.forEach((r, i) => {
    dummy.position.set(r.x, r.h + r.s * 0.25, r.z); dummy.scale.set(r.s, r.s * 0.75, r.s * 1.1); dummy.rotation.set(0, r.ry, 0); dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);
    rockMesh.setColorAt(i, lc.setHSL(0.08, 0.06, 0.42 + rng() * 0.12));
    addObstacle({ t: 1, x: r.x, z: r.z, r: r.s * 0.85, y0: r.h - 1, y1: r.h + r.s });
    addObstacle({ t: 2, x: r.x, y: r.h + r.s * 0.3, z: r.z, r: r.s * 0.72 });
  });
  scene.add(rockMesh);

  // 靶场射击线上也放几个物资点
  for (const ox of [-14, 0, 14]) W.lootSpots.push({ x: RG.x + ox, z: RG.zF + 6, y: RG.base, indoor: false });

  // 7. 野外物资点
  for (let i = 0, n = 0; i < 2000 && n < 140; i++) {
    const x = (rng() - 0.5) * 1000, z = (rng() - 0.5) * 1000;
    const h = heightAt(x, z);
    if (h < 2) continue;
    if (blocked(x, z, 1.5)) continue;
    W.lootSpots.push({ x, z, y: h, indoor: false });
    n++;
  }

  buildMapCanvas(allTrees);
  return W;
}

export const RANGE_MARKS = [10, 25, 50, 75, 100, 150, 200];

function signTexture(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2ead2'; ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 248, 120);
  ctx.fillStyle = '#c0392b'; ctx.fillRect(4, 4, 248, 22);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 76px Consolas, "DejaVu Sans Mono", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildRangeDecor(scene, mb) {
  const r = W.range, y = r.base;
  const white = new THREE.Color('#ecebe4'), concrete = new THREE.Color('#8e8d86'), wood = new THREE.Color('#6b4a2f');
  // 射击台与跑道边线、距离线
  mb.box(r.x, y + 0.03, r.zF + 5, r.hw * 2, 0.06, 10, concrete);
  mb.box(r.x - r.hw, y + 0.02, (r.z0 + r.z1) / 2, 0.3, 0.04, r.z0 - r.z1, white);
  mb.box(r.x + r.hw, y + 0.02, (r.z0 + r.z1) / 2, 0.3, 0.04, r.z0 - r.z1, white);
  for (const d of RANGE_MARKS) mb.box(r.x, y + 0.02, r.zF - d, r.hw * 2, 0.04, 0.35, white);
  // 掩体矮墙（训练“只露头”用）
  const wx = r.x + 8, wz = r.zF - 16.5, wy0 = y - 1, wy1 = y + 1.35;
  mb.box(wx, (wy0 + wy1) / 2, wz, 3.4, wy1 - wy0, 0.35, concrete);
  addObstacle({ t: 0, minX: wx - 1.7, maxX: wx + 1.7, minY: wy0, maxY: wy1, minZ: wz - 0.175, maxZ: wz + 0.175 });
  // 距离牌
  for (const d of RANGE_MARKS) {
    const sx = r.x - r.hw - 2, sz = r.zF - d;
    mb.box(sx, y + 1.4, sz, 0.16, 2.8, 0.16, wood);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshBasicMaterial({ map: signTexture(d + 'm') }));
    board.position.set(sx, y + 3.4, sz);
    scene.add(board);
  }
  // 入口牌
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1d2329'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffc928'; ctx.font = 'bold 64px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('训练靶场', 256, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  for (const sgn of [-1, 1]) mb.box(r.x + sgn * 6, y + 2, r.zF + 11, 0.2, 4, 0.2, wood);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: tex }));
  banner.position.set(r.x, y + 4.6, r.zF + 11);
  scene.add(banner);
}

function buildMapCanvas(trees) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const k = (MAP_HALF * 2) / S;
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const x = -MAP_HALF + (px + 0.5) * k, z = -MAP_HALF + (py + 0.5) * k;
    const h = heightAt(x, z);
    const shade = clamp((heightAt(x - 2, z - 2) - heightAt(x + 2, z + 2)) * 0.09, -0.25, 0.25);
    let r, g, b;
    if (h < -0.2) { const dpt = clamp(-h / 20, 0, 1); r = 40 - dpt * 15; g = 104 - dpt * 30; b = 140 - dpt * 20; }
    else if (h < 2.4) { r = 214; g = 196; b = 140; }
    else { const t = clamp(h / 55, 0, 1); r = 92 + t * 60; g = 134 + t * 20; b = 62 + t * 50; }
    const f = 1 + shade;
    const i = (py * S + px) * 4;
    img.data[i] = r * f; img.data[i + 1] = g * f; img.data[i + 2] = b * f; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(40,60,30,0.35)';
  for (const t of trees) {
    const px = (t.x + MAP_HALF) / k, py = (t.z + MAP_HALF) / k;
    ctx.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
  }
  {
    const r = W.range;
    const x0 = (r.x - r.hw + MAP_HALF) / k, y0 = (r.z1 + MAP_HALF) / k;
    ctx.fillStyle = 'rgba(190,178,140,0.9)';
    ctx.fillRect(x0, y0, (r.hw * 2) / k, (r.z0 - r.z1) / k);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (const d of RANGE_MARKS) ctx.fillRect(x0, (r.zF - d + MAP_HALF) / k, (r.hw * 2) / k, 1);
  }
  ctx.fillStyle = '#3b3631';
  for (const b of W.buildings) {
    const x0 = (b.inMinX - 0.4 + MAP_HALF) / k, y0 = (b.inMinZ - 0.4 + MAP_HALF) / k;
    ctx.fillRect(x0, y0, Math.max(1.5, (b.inMaxX - b.inMinX + 0.8) / k), Math.max(1.5, (b.inMaxZ - b.inMinZ + 0.8) / k));
  }
  W.mapCanvas = cv;
}
