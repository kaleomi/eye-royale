// 读码攻击：可见性判定、命中、扫描器、闪光
import * as THREE from 'three';
import { G } from './state.js';
import { segBlocked } from './world.js';
import { SCAN_RANGE, SCAN_TIME, REVEAL_TIME, WEAPONS, weaponTransform } from './config.js';

const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), proj = new THREE.Vector3();

export function platePos(t, part, out) {
  t.forward(fwd);
  const crouch = t.crouch && t.state === 'ground';
  const y = t.pos.y + (part === 'head' ? (crouch ? 1.44 : 1.86) : (crouch ? 0.82 : 1.24));
  return out.set(t.pos.x + fwd.x * 0.24, y, t.pos.z + fwd.z * 0.24);
}

// 目标的数字牌朝向观察点的程度（1 = 正对，<0 = 背对）
export function plateFacing(t, ex, ez) {
  t.forward(fwd);
  const dx = ex - t.pos.x, dz = ez - t.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  return (fwd.x * dx + fwd.z * dz) / d;
}

export function losBetween(a, b) {
  return !segBlocked(a.pos.x, a.eyeY(), a.pos.z, b.pos.x, b.chestY(), b.pos.z);
}

// viewer 能否看清 target 的某块数字牌（不含距离/清晰度判断）
export function plateVisible(viewer, target, part, ex, ey, ez) {
  if (!target.alive) return false;
  const revealed = (target.reveal.get(viewer.id) || 0) > 0;
  if (revealed) {
    tmp.set(target.pos.x, target.chestY(), target.pos.z);
  } else {
    if (plateFacing(target, ex, ez) < 0.22) return false;
    platePos(target, part, tmp);
  }
  // 终点往观察者方向收一点，避免被目标自身所在的草丛误判
  const dx = ex - tmp.x, dy = ey - tmp.y, dz = ez - tmp.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  return !segBlocked(ex, ey, ez, tmp.x + dx / d * 0.05, tmp.y + dy / d * 0.05, tmp.z + dz / d * 0.05);
}

export function applyHit(att, tgt, part, weapon = 'std') {
  const W = WEAPONS[weapon] || WEAPONS.std;
  tgt.lastWeapon = weapon;
  const res = tgt.takeHit(part, att, W.mult, !!W.pierce);
  res.weapon = weapon;
  G.hooks.onHit && G.hooks.onHit(att, tgt, part, res);
  return res;
}

function registerMiss(p, why) {
  p.missStreak++;
  p.missDecay = 5;
  const locks = [0.5, 0.8, 1.2, 1.6];
  p.lockT = locks[Math.min(p.missStreak - 1, locks.length - 1)];
  G.stats.miss++;
  G.hooks.onMiss && G.hooks.onMiss(p, why);
}

// 玩家输入满 4 位后判定
export function playerSubmit(code, zoom = 1) {
  const p = G.player, cam = G.camera;
  if (!p.alive) return;
  const w = p.weapon, W = WEAPONS[w];
  if (p.blindT > 1.2) { registerMiss(p, '你被闪光致盲，看不清'); return; }
  if (W.scope && zoom < W.scope) { registerMiss(p, `${W.name}需要开 ${W.scope} 倍以上的镜`); return; }
  let target = null, part = null;
  for (const a of G.actors) {
    if (a === p || !a.alive) continue;
    if (weaponTransform(w, a.headCode) === code) { target = a; part = 'head'; break; }
    if (weaponTransform(w, a.bodyCode) === code) { target = a; part = 'body'; break; }
  }
  if (!target) { registerMiss(p, '读错了'); return; }
  const ex = cam.position.x, ey = cam.position.y, ez = cam.position.z;
  const revealed = (target.reveal.get(p.id) || 0) > 0;
  if (revealed) proj.set(target.pos.x, target.chestY(), target.pos.z); else platePos(target, part, proj);
  const dist = proj.distanceTo(cam.position);
  proj.project(cam);
  const onScreen = proj.z < 1 && Math.abs(proj.x) < 1.05 && Math.abs(proj.y) < 1.05;
  if (!onScreen || dist > 420 || !plateVisible(p, target, part, ex, ey, ez)) {
    registerMiss(p, '目标不在视野内');
    return;
  }
  p.missStreak = 0;
  if (part === 'head') G.stats.head++; else G.stats.body++;
  applyHit(p, target, part, w);
}

// 扫描器：靠近背对你的敌人，4 秒后显示其数字
let scanAcc = 0;
export function updateScanners(dt) {
  scanAcc += dt;
  for (const v of G.actors) {
    if (!v.alive || !v.scanner || v.state !== 'ground') continue;
    for (const t of G.actors) {
      if (t === v || !t.alive || t.state !== 'ground') continue;
      const dx = t.pos.x - v.pos.x, dz = t.pos.z - v.pos.z;
      const d2 = dx * dx + dz * dz;
      let prog = v.scanProg.get(t.id) || 0;
      const revealed = (t.reveal.get(v.id) || 0) > 0;
      if (d2 < SCAN_RANGE * SCAN_RANGE && !revealed && Math.abs(t.pos.y - v.pos.y) < 6) {
        if (plateFacing(t, v.pos.x, v.pos.z) < 0.22 && losBetween(v, t)) {
          prog += dt;
          if (prog >= SCAN_TIME) {
            t.reveal.set(v.id, REVEAL_TIME);
            prog = 0;
            G.hooks.onReveal && G.hooks.onReveal(v, t);
          }
          v.scanProg.set(t.id, prog);
          continue;
        }
      }
      if (prog > 0) {
        prog = Math.max(0, prog - dt * 1.5);
        if (prog === 0) v.scanProg.delete(t.id); else v.scanProg.set(t.id, prog);
      }
    }
  }
}

export function doFlash(pos, owner) {
  for (const a of G.actors) {
    if (!a.alive || (a.state !== 'ground' && a.state !== 'chute')) continue;
    const ey = a.eyeY();
    const dx = pos.x - a.pos.x, dy = pos.y - ey, dz = pos.z - a.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 28) continue;
    // 闪光很亮：爆点或其上方 1.5 米任一可见即受影响
    if (segBlocked(a.pos.x, ey, a.pos.z, pos.x, pos.y + 0.3, pos.z) && segBlocked(a.pos.x, ey, a.pos.z, pos.x, pos.y + 1.5, pos.z)) continue;
    let facing;
    if (a.isPlayer) {
      G.camera.getWorldDirection(tmp);
      facing = (tmp.x * dx + tmp.y * dy + tmp.z * dz) / Math.max(0.01, d);
    } else {
      a.forward(fwd);
      facing = (fwd.x * dx + fwd.z * dz) / Math.max(0.01, Math.hypot(dx, dz));
    }
    const inten = (facing > 0.3 ? 1 : 0.32) * (d < 6 ? 1 : 1 - ((d - 6) / 22) * 0.75);
    const dur = 0.8 + 4.6 * inten;
    if (dur > a.blindT) { a.blindT = dur; a.blindMax = dur; }
    if (a.isPlayer && G.hooks.onBlind) G.hooks.onBlind(inten);
  }
  G.hooks.onFlashFx && G.hooks.onFlashFx(pos, owner);
}
