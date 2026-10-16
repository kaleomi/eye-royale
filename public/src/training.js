// 训练场：固定靶场 + 木人 + 读码用时统计
import * as THREE from 'three';
import { G } from './state.js';
import { W } from './world.js';
import { groundAt } from './physics.js';
import { Actor } from './actor.js';
import { plateVisible } from './combat.js';

export const T = { active: false, dummies: [], stats: null };

// d = 距射击线的距离（米），x = 横向偏移
const SPOTS = [
  { d: 10, x: -6, name: '近距' },
  { d: 18, x: 8, name: '掩体后', tip: '矮墙挡住了胸口，只能读头' },
  { d: 24, x: -13, name: '背身', back: true, tip: '背对你：走到 14 米内让扫描器工作' },
  { d: 32, x: 2, name: '移动', move: true },
  { d: 45, x: -4, name: '干扰涂层', camo: true },
  { d: 60, x: 12, name: '三级头甲', armored: true, tip: '试试破甲码' },
  { d: 100, x: -8, name: '100米' },
  { d: 150, x: 6, name: '150米' },
];

const v3 = new THREE.Vector3();

function placeDummy(a) {
  const R = W.range, s = a.dummy;
  const x = R.x + s.x, z = R.zF - s.d;
  a.pos.set(x, groundAt(x, z, R.base + 5), z);
  a.vel.set(0, 0, 0);
  a.yaw = s.back ? 0 : Math.PI;           // 0 = 面朝 -z（背对射击线）
  a.hp = 100;
  a.alive = true;
  a.state = 'ground';
  a.onGround = true;
  a.char.deadT = 0;
  a.char.root.rotation.x = 0;
  a.char.root.visible = true;
  if (s.armored) {
    a.helmet = { lvl: 3, dura: 230, max: 230 };
    a.armor = { lvl: 3, dura: 230, max: 230 };
  }
  a.refreshGear();
  if (s.camo) a.camoT = 1e9;
  a.resetCodes();
  a.visibleSince = null;
}

export function setupTraining() {
  T.active = true;
  T.dummies = [];
  T.stats = { hits: 0, head: 0, body: 0, times: [], best: null, last: null };
  for (const s of SPOTS) {
    const a = new Actor('木人·' + s.name, false, new THREE.Color().setHSL(0.07, 0.4, 0.42));
    a.dummy = s;
    G.actors.push(a);
    T.dummies.push(a);
    placeDummy(a);
  }
}

export function clearTraining() {
  T.active = false;
  T.dummies = [];
}

export function trainingDeath(a) {
  a.respawnT = 1.5;
}

// 玩家读中木人：记录这次读码用了多久
export function trainingHit(tgt, part) {
  const now = G.matchTime;
  const start = Math.max(tgt.prevCodeAt ?? now, tgt.visibleSince ?? now);
  const rt = now - start;
  T.stats.hits++;
  if (part === 'head') T.stats.head++; else T.stats.body++;
  if (rt > 0.05 && rt < 30) {
    T.stats.times.push(rt);
    T.stats.last = rt;
    if (T.stats.best == null || rt < T.stats.best) T.stats.best = rt;
    return rt;
  }
  return null;
}

export function updateTraining(dt) {
  const cam = G.camera, p = G.player;
  for (const a of T.dummies) {
    const s = a.dummy;
    if (!a.alive) {
      a.respawnT -= dt;
      if (a.respawnT <= 0) placeDummy(a);
      continue;
    }
    if (s.move) {
      const R = W.range, t = G.matchTime;
      const x = R.x + s.x + Math.sin(t * 0.9) * 7;
      a.vel.set(Math.cos(t * 0.9) * 6.3, 0, 0);
      a.pos.x = x;
      a.pos.y = groundAt(x, a.pos.z, a.pos.y + 1);
    }
    // 记录木人数字何时进入视野（用来算读码用时）
    let vis = false;
    if (p && p.alive) {
      v3.set(a.pos.x, a.chestY(), a.pos.z).project(cam);
      if (v3.z < 1 && Math.abs(v3.x) < 1 && Math.abs(v3.y) < 1) {
        const ex = cam.position.x, ey = cam.position.y, ez = cam.position.z;
        vis = plateVisible(p, a, 'body', ex, ey, ez) || plateVisible(p, a, 'head', ex, ey, ez);
      }
    }
    if (vis) { if (a.visibleSince == null) a.visibleSince = G.matchTime; }
    else a.visibleSince = null;
  }
}

export function trainingSummary() {
  const st = T.stats;
  const n = st.times.length;
  const avg = n ? st.times.reduce((x, y) => x + y, 0) / n : null;
  return { ...st, avg };
}
