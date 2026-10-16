// 地面物资、拾取、投掷物（闪光/烟雾）、空投
import * as THREE from 'three';
import { G } from './state.js';
import { W, heightAt, forEachNear, segSphere } from './world.js';
import { groundAt } from './physics.js';
import { ITEM_DEFS, LOOT_TABLE, ARMOR_DURA } from './config.js';
import { weightedPick } from './util.js';
import { doFlash } from './combat.js';

export const I = { ground: [], throws: [], smokes: [], drops: [] };

// ---------- 模型 ----------
const geo = {}, mat = {};
function itemMesh(key) {
  const d = ITEM_DEFS[key];
  if (!geo.helmet) {
    geo.helmet = new THREE.SphereGeometry(0.24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.armor = new THREE.BoxGeometry(0.55, 0.12, 0.45);
    geo.bag = new THREE.BoxGeometry(0.45, 0.32, 0.25);
    geo.scope = new THREE.CylinderGeometry(0.07, 0.09, 0.42, 8).rotateZ(Math.PI / 2);
    geo.scanner = new THREE.BoxGeometry(0.3, 0.1, 0.22);
    geo.heal = new THREE.BoxGeometry(0.34, 0.16, 0.26);
    geo.boost = new THREE.CylinderGeometry(0.07, 0.07, 0.26, 10);
    geo.throw = new THREE.CylinderGeometry(0.08, 0.08, 0.22, 8);
    geo.camo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    geo.ring = new THREE.RingGeometry(0.42, 0.5, 20).rotateX(-Math.PI / 2);
    geo.crate = new THREE.BoxGeometry(1.4, 1.1, 1.4);
    geo.nade = new THREE.SphereGeometry(0.09, 8, 6);
  }
  if (!mat[key]) mat[key] = new THREE.MeshLambertMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.25 });
  const m = new THREE.Mesh(geo[d.cat], mat[key]);
  const lvl = d.level || (d.cat === 'scope' ? (d.zoom === 8 ? 3 : d.zoom === 4 ? 2 : 1) : d.cat === 'scanner' ? 3 : 0);
  if (lvl) {
    const ringColor = [0, 0xd8d8d8, 0x5ab0ff, 0xc77dff][lvl];
    const ring = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    ring.position.y = -0.1;
    m.add(ring);
  }
  return m;
}

export function spawnGround(key, x, z, count = 1, dura = null, yHint = null) {
  const y = groundAt(x, z, yHint != null ? yHint + 0.5 : heightAt(x, z) + 1);
  const mesh = itemMesh(key);
  mesh.position.set(x, y + 0.14, z);
  mesh.rotation.y = Math.random() * 6.28;
  mesh.visible = false;
  G.scene.add(mesh);
  const it = { key, count, dura, x, y, z, mesh, alive: true };
  I.ground.push(it);
  return it;
}

function removeItem(it) {
  it.alive = false;
  G.scene.remove(it.mesh);
  const i = I.ground.indexOf(it);
  if (i >= 0) I.ground.splice(i, 1);
}

export function defaultCount(key) {
  const d = ITEM_DEFS[key];
  return d.stack || 1;
}

export function spawnLoot() {
  for (const s of W.lootSpots) {
    const chance = s.indoor ? 0.85 : 0.5;
    if (Math.random() > chance) continue;
    const n = s.indoor && Math.random() < 0.3 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const key = weightedPick(LOOT_TABLE);
      spawnGround(key, s.x + (Math.random() - 0.5) * 1.2 * i, s.z + (Math.random() - 0.5) * 1.2 * i, defaultCount(key), null, s.y);
    }
  }
}

export function clearAll() {
  for (const it of I.ground) G.scene.remove(it.mesh);
  for (const t of I.throws) G.scene.remove(t.mesh);
  for (const s of I.smokes) G.scene.remove(s.group);
  for (const d of I.drops) { G.scene.remove(d.mesh); }
  I.ground.length = 0; I.throws.length = 0; I.smokes.length = 0; I.drops.length = 0;
}

// ---------- 拾取 ----------
export function itemLabel(it) {
  const d = ITEM_DEFS[it.key];
  let s = d.name;
  if (it.count > 1) s += ' ×' + it.count;
  if ((d.cat === 'helmet' || d.cat === 'armor') && it.dura != null) s += ` (${Math.round(it.dura / ARMOR_DURA[d.level] * 100)}%)`;
  return s;
}

export function wantsItem(a, it) {
  const d = ITEM_DEFS[it.key];
  switch (d.cat) {
    case 'helmet': return !a.helmet || a.helmet.lvl < d.level;
    case 'armor': return !a.armor || a.armor.lvl < d.level;
    case 'bag': return a.bag < d.level;
    case 'scope': return !a.scopes.has(d.zoom);
    case 'scanner': return !a.scanner;
    default: return a.capacity() - a.invWeight() >= d.weight;
  }
}

export function tryPickup(a, it) {
  if (!it.alive) return { ok: false, msg: '' };
  const d = ITEM_DEFS[it.key];
  const dropOld = (key, dura) => spawnGround(key, a.pos.x + (Math.random() - 0.5), a.pos.z + (Math.random() - 0.5), 1, dura, a.pos.y);
  switch (d.cat) {
    case 'helmet': case 'armor': {
      const slot = d.cat, cur = a[slot];
      const dura = it.dura ?? ARMOR_DURA[d.level];
      if (cur && (cur.lvl > d.level || (cur.lvl === d.level && cur.dura >= dura))) return { ok: false, msg: '已装备更好的' + (slot === 'helmet' ? '头盔' : '护甲') };
      if (cur) dropOld(slot + cur.lvl, cur.dura);
      a[slot] = { lvl: d.level, dura, max: ARMOR_DURA[d.level] };
      removeItem(it); a.refreshGear();
      return { ok: true, msg: '装备 ' + d.name };
    }
    case 'bag': {
      if (a.bag >= d.level) return { ok: false, msg: '已有更好的背包' };
      if (a.bag > 0) dropOld('bag' + a.bag, null);
      a.bag = d.level; removeItem(it); a.refreshGear();
      return { ok: true, msg: '装备 ' + d.name };
    }
    case 'scope': {
      if (a.scopes.has(d.zoom)) return { ok: false, msg: '已有' + d.name };
      a.scopes.add(d.zoom); removeItem(it);
      return { ok: true, msg: '获得 ' + d.name + (a.isPlayer ? '（右键开镜，滚轮切换）' : '') };
    }
    case 'scanner': {
      if (a.scanner) return { ok: false, msg: '已有扫描器' };
      a.scanner = true; removeItem(it);
      return { ok: true, msg: '获得 扫描器（靠近背对你的敌人自动扫描）' };
    }
    default: {
      const free = a.capacity() - a.invWeight();
      const n = Math.min(it.count, Math.floor(free / d.weight));
      if (n <= 0) return { ok: false, msg: '背包已满' };
      a.inv[it.key] += n;
      it.count -= n;
      if (it.count <= 0) removeItem(it);
      return { ok: true, msg: `拾取 ${d.name} ×${n}` };
    }
  }
}

// 找到角色面前最近的可拾取物
const v1 = new THREE.Vector3();
export function nearestItem(a, maxD = 2.6, dir = null) {
  let best = null, bestScore = 1e9;
  for (const it of I.ground) {
    const dx = it.x - a.pos.x, dz = it.z - a.pos.z, dy = it.y - a.pos.y;
    if (Math.abs(dy) > 2.2) continue;
    const d = Math.hypot(dx, dz);
    if (d > maxD) continue;
    let score = d;
    if (dir) {
      const dot = (dir.x * dx + dir.z * dz) / Math.max(0.01, d);
      score -= dot * 1.2;
    }
    if (score < bestScore) { bestScore = score; best = it; }
  }
  return best;
}

// ---------- 投掷物 ----------
export function throwNade(a, kind, dir) {
  if (!a.alive || a.inv[kind] <= 0 || a.throwCd > 0) return false;
  a.inv[kind]--;
  a.throwCd = 1.0;
  itemMesh('flash');
  const m = new THREE.Mesh(geo.nade, new THREE.MeshLambertMaterial({ color: kind === 'flash' ? 0xe8e8e8 : 0x51735a }));
  const p = new THREE.Vector3(a.pos.x, a.eyeY() - 0.15, a.pos.z).addScaledVector(dir, 0.5);
  const v = dir.clone().multiplyScalar(16);
  v.y += 3.2;
  m.position.copy(p);
  G.scene.add(m);
  I.throws.push({ kind, pos: p, vel: v, t: kind === 'flash' ? 1.6 : 1.3, owner: a, mesh: m, rest: false });
  G.hooks.onThrow && G.hooks.onThrow(a, kind);
  return true;
}

function insideBox(x, y, z) {
  return forEachNear(x, z, x, z, o => o.t === 0 && x > o.minX && x < o.maxX && y > o.minY && y < o.maxY && z > o.minZ && z < o.maxZ);
}

let smokeTex = null;
function getSmokeTex() {
  if (smokeTex) return smokeTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  smokeTex = new THREE.CanvasTexture(c);
  return smokeTex;
}

export function createSmoke(pos, opts = {}) {
  const group = new THREE.Group();
  const sprites = [];
  const n = opts.flare ? 16 : 26;
  for (let i = 0; i < n; i++) {
    const shade = opts.flare ? 1 : 0.78 + Math.random() * 0.2;
    const m = new THREE.SpriteMaterial({ map: getSmokeTex(), transparent: true, depthWrite: false, opacity: 0, color: opts.flare ? new THREE.Color(0xff3b30) : new THREE.Color(shade, shade, shade) });
    const s = new THREE.Sprite(m);
    let off;
    if (opts.flare) off = new THREE.Vector3((Math.random() - 0.5) * 0.4, i / n * 6, (Math.random() - 0.5) * 0.4);
    else off = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(0.25 + Math.random() * 0.75);
    sprites.push({ s, off, spin: Math.random() * 6 });
    group.add(s);
  }
  group.position.copy(pos);
  G.scene.add(group);
  const sm = { pos: pos.clone(), t: 0, life: opts.flare ? 45 : 24, r: 0, group, sprites, flare: !!opts.flare, fade: 0 };
  I.smokes.push(sm);
  return sm;
}

W.smokeTest = (ax, ay, az, dx, dy, dz) => {
  for (const s of I.smokes) {
    if (s.flare || s.fade < 0.45 || s.r < 1.2) continue;
    if (segSphere(s.pos.x, s.pos.y + s.r * 0.45, s.pos.z, s.r * 0.92, ax, ay, az, dx, dy, dz, false)) return true;
  }
  return false;
};

export function spawnAirdrop(x, z) {
  itemMesh('flash');
  const crate = new THREE.Group();
  const box = new THREE.Mesh(geo.crate, new THREE.MeshLambertMaterial({ color: 0x2f5fa8 }));
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.2, 1.45), new THREE.MeshLambertMaterial({ color: 0xd63a2f }));
  crate.add(box, band);
  const chute = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshLambertMaterial({ color: 0xd63a2f, side: THREE.DoubleSide }));
  chute.position.y = 6; chute.scale.y = 0.6;
  crate.add(chute);
  crate.position.set(x, 260, z);
  G.scene.add(crate);
  const d = { x, z, mesh: crate, chute, landed: false };
  I.drops.push(d);
  return d;
}

const AIRDROP_LOOT = ['helmet3', 'armor3', 'scope8', 'medkit', 'bag3', 'scanner', 'drink', 'flash'];

export function updateItems(dt) {
  // 投掷物
  for (let i = I.throws.length - 1; i >= 0; i--) {
    const t = I.throws[i];
    t.t -= dt;
    if (!t.rest) {
      const px = t.pos.x, py = t.pos.y, pz = t.pos.z;
      t.vel.y -= 16 * dt;
      t.pos.addScaledVector(t.vel, dt);
      if (insideBox(t.pos.x, t.pos.y, t.pos.z)) {
        t.pos.set(px, py, pz);
        t.vel.x *= -0.4; t.vel.z *= -0.4; t.vel.y *= 0.4;
      }
      const g = groundAt(t.pos.x, t.pos.z, t.pos.y + 0.3);
      if (t.pos.y < g + 0.09) {
        t.pos.y = g + 0.09;
        t.vel.y = -t.vel.y * 0.3;
        t.vel.x *= 0.55; t.vel.z *= 0.55;
        if (Math.abs(t.vel.y) < 1 && Math.hypot(t.vel.x, t.vel.z) < 0.6) t.rest = true;
      }
      t.mesh.position.copy(t.pos);
    }
    if (t.t <= 0) {
      G.scene.remove(t.mesh);
      I.throws.splice(i, 1);
      if (t.kind === 'flash') doFlash(t.pos, t.owner);
      else { createSmoke(t.pos); G.hooks.onSmoke && G.hooks.onSmoke(t.pos); }
    }
  }
  // 烟雾
  for (let i = I.smokes.length - 1; i >= 0; i--) {
    const s = I.smokes[i];
    s.t += dt;
    const grow = Math.min(1, s.t / 2.2);
    s.fade = Math.min(1, (s.life - s.t) / 4);
    s.r = 7.5 * grow;
    s.sprites.forEach((sp, k) => {
      if (s.flare) {
        sp.s.position.set(sp.off.x + Math.sin(s.t + k) * 0.3, (sp.off.y + s.t * 2.5) % 14, sp.off.z);
        sp.s.scale.setScalar(1.2 + sp.s.position.y * 0.25);
        sp.s.material.opacity = 0.55 * s.fade * (1 - sp.s.position.y / 15);
      } else {
        sp.s.position.set(sp.off.x * s.r, 0.6 + sp.off.y * s.r * 0.9, sp.off.z * s.r);
        sp.s.scale.setScalar(2.5 + s.r * 0.95);
        sp.s.material.opacity = 0.9 * grow * Math.max(0, s.fade);
        sp.s.material.rotation = sp.spin + s.t * 0.05;
      }
    });
    if (s.t >= s.life) { G.scene.remove(s.group); I.smokes.splice(i, 1); }
  }
  // 空投
  for (const d of I.drops) {
    if (d.landed) continue;
    const g = groundAt(d.x, d.z, d.mesh.position.y);
    d.mesh.position.y -= 9 * dt;
    d.mesh.rotation.y += dt * 0.3;
    if (d.mesh.position.y <= g + 0.55) {
      d.mesh.position.y = g + 0.55;
      d.landed = true;
      d.chute.visible = false;
      const picks = AIRDROP_LOOT.slice().sort(() => Math.random() - 0.5).slice(0, 4);
      picks.forEach((k, i) => {
        const a = i / picks.length * Math.PI * 2;
        spawnGround(k, d.x + Math.cos(a) * 1.6, d.z + Math.sin(a) * 1.6, defaultCount(k), null, g);
      });
      createSmoke(new THREE.Vector3(d.x, g, d.z), { flare: true });
      G.hooks.onAirdropLand && G.hooks.onAirdropLand(d);
    }
  }
  // 只显示附近的物资
  const cam = G.camera.position;
  for (const it of I.ground) {
    const dx = it.x - cam.x, dz = it.z - cam.z;
    it.mesh.visible = dx * dx + dz * dz < 110 * 110;
    if (it.mesh.visible) it.mesh.rotation.y += dt * 0.6;
  }
}
