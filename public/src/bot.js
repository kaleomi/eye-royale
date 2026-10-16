// 机器人 AI：跳伞、搜刮、进圈、读码对战
import * as THREE from 'three';
import { G } from './state.js';
import { W, heightAt, buildingAt } from './world.js';
import { moveActor, groundAt } from './physics.js';
import { Z, outsideZone, insideNext } from './zone.js';
import { I, tryPickup, throwNade, wantsItem } from './items.js';
import { plateVisible, plateFacing, losBetween, applyHit } from './combat.js';
import { P, canDrop, pathParamNear } from './plane.js';
import { READ_RANGE_BODY, READ_RANGE_HEAD, DIFFICULTY, WATER_LEVEL, WEAPONS } from './config.js';
import { angleDiff, clamp, lerp } from './util.js';

const fwd = new THREE.Vector3(), tfwd = new THREE.Vector3(), dirV = new THREE.Vector3();

export function initBot(b) {
  const diff = DIFFICULTY[G.settings.diff];
  const skill = Math.random();
  let land;
  if (Math.random() < 0.78 && W.towns.length) {
    const t = W.towns[Math.floor(Math.random() * W.towns.length)];
    land = { x: t.x + (Math.random() - 0.5) * t.r * 1.4, z: t.z + (Math.random() - 0.5) * t.r * 1.4 };
  } else if (W.buildings.length) {
    const bb = W.buildings[Math.floor(Math.random() * W.buildings.length)];
    land = { x: bb.x + (Math.random() - 0.5) * 20, z: bb.z + (Math.random() - 0.5) * 20 };
  } else land = { x: 0, z: 0 };
  b.ai = {
    land,
    jumpT: clamp(pathParamNear(land.x, land.z), 0.1, 0.9) + (Math.random() - 0.5) * 0.08,
    chuteAGL: 120 + Math.random() * 80,
    skill,
    readBase: lerp(3.0, 1.45, skill) * diff.readMul,
    acc: clamp(lerp(0.8, 0.95, skill) + diff.acc, 0.6, 0.99),
    headPref: lerp(0.12, 0.5, skill),
    think: Math.random() * 0.3,
    mode: 'loot',
    target: null, lastSeen: -99, lastSeenPos: new THREE.Vector3(), seenNow: false,
    readTarget: null, readPart: null, readT: 0, readNeed: 1, readCode: '', readPause: 0,
    canBody: false, canHead: false,
    path: [], goal: null, goalItem: null, ignore: new Set(), visited: new Set(),
    stuckT: 0, stuckCount: 0, lastPos: new THREE.Vector3(), detour: { x: 0, z: 0 }, detourT: 0,
    strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0,
    nadeCd: 4 + Math.random() * 6, camoCd: 0,
    sprint: true, stop: false, faceAt: null, faceAway: null,
    zoneGoal: null, zoneKey: '', wander: null, wanderT: 0,
  };
}

export function updateBot(b, dt) {
  if (!b.alive) return;
  const ai = b.ai;
  if (b.state === 'plane') {
    b.pos.copy(P.pos);
    if ((P.t >= ai.jumpT && canDrop()) || P.t > 0.93 || !P.active) {
      b.state = 'fall';
      b.pos.copy(P.pos); b.pos.y -= 4;
      b.vel.set(0, 0, 0);
      b.char.root.visible = true;
    }
    return;
  }
  if (b.state === 'fall' || b.state === 'chute') {
    const dx = ai.land.x - b.pos.x, dz = ai.land.z - b.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const hs = b.state === 'fall' ? 24 : 11, vs = b.state === 'fall' ? 46 : 5.5;
    const sp = Math.min(hs, d * 0.8);
    b.vel.set(dx / d * sp, -vs, dz / d * sp);
    if (d > 2) b.yaw = Math.atan2(-dx, -dz);
    b.pos.addScaledVector(b.vel, dt);
    let g = groundAt(b.pos.x, b.pos.z, b.pos.y);
    if (g < WATER_LEVEL - 1.25) g = WATER_LEVEL - 1.25;
    if (b.state === 'fall' && b.pos.y - g < ai.chuteAGL) b.state = 'chute';
    if (b.pos.y <= g) {
      b.pos.y = g; b.vel.set(0, 0, 0);
      b.state = 'ground'; b.onGround = true;
      ai.lastPos.copy(b.pos);
      ai.landedAt = G.matchTime;
    }
    return;
  }
  // 地面
  ai.think -= dt;
  if (ai.think <= 0) { ai.think = 0.2 + Math.random() * 0.12; think(b); }
  if (ai.nadeCd > 0) ai.nadeCd -= dt;
  if (ai.camoCd > 0) ai.camoCd -= dt;
  updateReading(b, dt);
  steer(b, dt);
  moveActor(b, dt);
}

function dist2(a, b) { return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z); }

function pickHeal(b) {
  if (b.hp < 50 && b.inv.firstaid) return 'firstaid';
  if (b.hp < 45 && b.inv.medkit) return 'medkit';
  if (b.hp < 75 && b.inv.bandage) return 'bandage';
  if (b.hp < 75 && b.inv.firstaid) return 'firstaid';
  if (b.hp < 60 && b.inv.medkit) return 'medkit';
  return null;
}

function nearestDoor(bd, x, z) {
  let best = bd.doors[0], bd2 = 1e9;
  for (const d of bd.doors) {
    const dd = (d.out.x - x) ** 2 + (d.out.z - z) ** 2;
    if (dd < bd2) { bd2 = dd; best = d; }
  }
  return best;
}

function planPath(sx, sz, gx, gz) {
  const path = [];
  const bf = buildingAt(sx, sz, 0), bt = buildingAt(gx, gz, 0);
  let cx = sx, cz = sz;
  if (bf && bf !== bt) {
    const dr = nearestDoor(bf, gx, gz);
    path.push(dr.in, dr.out); cx = dr.out.x; cz = dr.out.z;
  }
  if (bt && bt !== bf) {
    const dr = nearestDoor(bt, cx, cz);
    path.push(dr.out, dr.in);
  }
  path.push({ x: gx, z: gz });
  return path;
}

function setGoal(b, x, z, force = false) {
  const ai = b.ai;
  if (!force && ai.goal && ai.path.length && Math.hypot(ai.goal.x - x, ai.goal.z - z) < 1.5) return;
  ai.goal = { x, z };
  ai.path = planPath(b.pos.x, b.pos.z, x, z);
}

// AI 按场景挑读码武器
function pickWeapon(b, t, d, part) {
  const ws = b.weapons;
  const gear = part === 'head' ? t.helmet : t.armor;
  if (ws.has('pierce') && gear && gear.lvl >= 2) return 'pierce';
  if (ws.has('sniper') && d > 30 && b.bestScope() >= 4) return 'sniper';
  if (ws.has('quick') && d < 14 && b.hp < 70) return 'quick';
  if (ws.has('reverse') && Math.random() < 0.7) return 'reverse';
  if (ws.has('quick') && d < 14) return 'quick';
  return 'std';
}

function startRead(b, t, d) {
  const ai = b.ai;
  const part = ai.canHead && (Math.random() < ai.headPref || !ai.canBody) ? 'head' : 'body';
  ai.readTarget = t;
  ai.readPart = part;
  ai.readT = 0;
  ai.readPause = 0;
  ai.readCode = part === 'head' ? t.headCode : t.bodyCode;
  ai.readWeapon = pickWeapon(b, t, d, part);
  b.weapon = ai.readWeapon;
  ai.readNeed = ai.readBase * WEAPONS[ai.readWeapon].time * (1 + d / 45) * (part === 'head' ? 1.3 : 1) * (t.camoT > 0 ? 1.9 : 1) * (0.8 + Math.random() * 0.4);
}

function think(b) {
  const ai = b.ai;
  b.forward(fwd);
  // 1. 感知
  let best = null, bestS = 1e9;
  for (const t of G.actors) {
    if (t === b || !t.alive || t.state === 'plane') continue;
    const dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 170) continue;
    if (t.state !== 'ground' && d > 90) continue;
    const inFov = (fwd.x * dx + fwd.z * dz) / Math.max(d, 0.01) > -0.25;
    if (!inFov && d > 20) continue;
    if (!losBetween(b, t)) continue;
    let s = d;
    if (t === ai.target) s *= 0.7;
    if (s < bestS) { bestS = s; best = t; }
  }
  if (best) { ai.target = best; ai.lastSeen = G.matchTime; ai.lastSeenPos.copy(best.pos); }
  else if (ai.target && (!ai.target.alive || G.matchTime - ai.lastSeen > 7)) ai.target = null;
  ai.seenNow = !!best && best === ai.target;

  ai.faceAt = null; ai.faceAway = null; ai.stop = false; ai.sprint = true;
  ai.canBody = false; ai.canHead = false;
  const t = ai.target;
  const healKey = pickHeal(b);
  const out = outsideZone(b.pos.x, b.pos.z);

  // 2. 决策
  // 刚落地先搜物资，除非敌人贴脸或自己已经挨打
  const grace = G.matchTime - (ai.landedAt || 0) < 14 && b.hp >= 100;
  if (t && t.alive && !(grace && dist2(b, t) > 16)) {
    const d = dist2(b, t);
    if (b.hp < 40 && healKey && (d > 12 || !ai.seenNow) && !(out && Z.dps >= 4)) return flee(b, t, d, healKey);
    if (out && d > 30 && Z.dps >= 2) return rotate(b);
    return fight(b, t, d);
  }
  ai.readTarget = null;
  if (out || zonePressure(b)) return rotate(b);
  if (healKey && !b.using) { b.startUse(healKey); ai.stop = true; return; }
  if (b.using) { ai.stop = b.using.key !== 'drink'; }
  if (!b.using && b.inv.drink > 0 && b.boost < 30 && b.hp < 95) b.startUse('drink');
  loot(b);
}

function zonePressure(b) {
  if (Z.phase < 0 && Z.timer > 60) return false;
  if (insideNext(b.pos.x, b.pos.z, 10)) return false;
  const distToEdge = Math.hypot(b.pos.x - Z.next.x, b.pos.z - Z.next.z) - Z.next.r + 15;
  return Z.state === 'shrink' || Z.timer < distToEdge / 5.5 + 25;
}

function rotate(b) {
  const ai = b.ai;
  const key = Z.phase + ':' + Z.next.x.toFixed(0);
  if (ai.zoneKey !== key || !ai.zoneGoal) {
    ai.zoneKey = key;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Z.next.r * 0.6;
      const x = Z.next.x + Math.cos(a) * r, z = Z.next.z + Math.sin(a) * r;
      ai.zoneGoal = { x, z };
      if (heightAt(x, z) > 1) break;
    }
  }
  ai.mode = 'rotate';
  setGoal(b, ai.zoneGoal.x, ai.zoneGoal.z);
  ai.sprint = true;
}

function fight(b, t, d) {
  const ai = b.ai;
  ai.mode = 'fight';
  const zoom = b.bestScope();
  const stationary = d > 26 && zoom > 1;
  const bodyR = READ_RANGE_BODY * (stationary ? zoom : 1);
  const headR = READ_RANGE_HEAD * (stationary ? zoom : 1);
  const ex = b.pos.x, ey = b.eyeY(), ez = b.pos.z;
  const clear = ai.seenNow && b.blindT <= 0.3;
  ai.canBody = clear && d <= bodyR && plateVisible(b, t, 'body', ex, ey, ez);
  ai.canHead = clear && d <= headR && plateVisible(b, t, 'head', ex, ey, ez);
  ai.faceAt = t.pos;
  if (b.blindT > 0.3) {
    // 被闪：乱走
    ai.faceAt = null;
    setGoal(b, b.pos.x + (Math.random() - 0.5) * 8, b.pos.z + (Math.random() - 0.5) * 8, true);
    ai.sprint = false;
    return;
  }
  if (ai.canBody || ai.canHead) {
    if (ai.readTarget !== t) startRead(b, t, d);
    // 干扰涂层
    if (b.inv.camo > 0 && b.camoT <= 0 && ai.camoCd <= 0 && !b.using && d > 10 && Math.random() < 0.3) { b.startUse('camo'); ai.camoCd = 20; }
    // 闪光弹
    if (b.inv.flash > 0 && ai.nadeCd <= 0 && d > 7 && d < 26 && Math.random() < 0.3) {
      dirV.set(t.pos.x - b.pos.x, 0, t.pos.z - b.pos.z).normalize();
      dirV.y = clamp((d - 14) / 40, -0.1, 0.35);
      dirV.normalize();
      throwNade(b, 'flash', dirV);
      ai.nadeCd = 10;
    }
    if (stationary) { ai.stop = true; ai.goal = null; ai.path.length = 0; return; }
    ai.strafeT -= 0.25;
    if (ai.strafeT <= 0) { ai.strafe *= -1; ai.strafeT = 1 + Math.random() * 2; }
    const px = -(t.pos.z - b.pos.z) / d, pz = (t.pos.x - b.pos.x) / d;
    let gx = b.pos.x + px * 3 * ai.strafe, gz = b.pos.z + pz * 3 * ai.strafe;
    if (d > 18) { gx += (t.pos.x - b.pos.x) / d * 3; gz += (t.pos.z - b.pos.z) / d * 3; }
    const inB = buildingAt(b.pos.x, b.pos.z, 0);
    if (inB && buildingAt(gx, gz, 0) !== inB) { ai.stop = true; return; }
    setGoal(b, gx, gz, true);
    ai.sprint = false;
    return;
  }
  // 看不到数字
  if (ai.readTarget === t) { ai.readPause += 0.25; if (ai.readPause > 1.2) ai.readTarget = null; }
  if (ai.seenNow) {
    const facing = plateFacing(t, b.pos.x, b.pos.z);
    t.forward(tfwd);
    if (facing < 0.22) {
      if (b.scanner && d < 30) {
        // 绕到背后靠近，让扫描器工作
        setGoal(b, t.pos.x - tfwd.x * 6, t.pos.z - tfwd.z * 6, true);
        ai.sprint = d > 10;
      } else {
        // 绕到正面
        const side = ai.strafe;
        const fx = t.pos.x + tfwd.x * Math.min(d, 10) - tfwd.z * 4 * side;
        const fz = t.pos.z + tfwd.z * Math.min(d, 10) + tfwd.x * 4 * side;
        setGoal(b, fx, fz, true);
        ai.sprint = true;
      }
    } else {
      setGoal(b, t.pos.x, t.pos.z, true);
      ai.sprint = d > 22;
    }
  } else {
    setGoal(b, ai.lastSeenPos.x, ai.lastSeenPos.z);
    ai.sprint = true;
  }
}

function flee(b, t, d, healKey) {
  const ai = b.ai;
  ai.mode = 'flee';
  ai.readTarget = null;
  const dx = b.pos.x - t.pos.x, dz = b.pos.z - t.pos.z;
  const dd = Math.hypot(dx, dz) || 1;
  // 背对敌人，藏住数字
  ai.faceAway = t.pos;
  if (b.inv.smoke > 0 && ai.nadeCd <= 0 && d < 40 && ai.seenNow) {
    dirV.set(-dx / dd, -0.05, -dz / dd).normalize();
    throwNade(b, 'smoke', dirV);
    ai.nadeCd = 7;
  }
  if (!b.using && (d > 30 || !ai.seenNow)) b.startUse(healKey);
  setGoal(b, b.pos.x + dx / dd * 14, b.pos.z + dz / dd * 14, true);
  ai.sprint = !b.using;
}

function loot(b) {
  const ai = b.ai;
  ai.mode = 'loot';
  let it = ai.goalItem;
  if (!it || !it.alive || ai.ignore.has(it) || !wantsItem(b, it)) {
    it = null;
    let bestD = 70;
    for (const g of I.ground) {
      if (ai.ignore.has(g)) continue;
      const d = Math.hypot(g.x - b.pos.x, g.z - b.pos.z);
      if (d >= bestD || Math.abs(g.y - b.pos.y) > 4) continue;
      if (!wantsItem(b, g)) continue;
      if (Z.phase >= 0 && outsideZone(g.x, g.z)) continue;
      bestD = d; it = g;
    }
    ai.goalItem = it;
  }
  if (it) {
    const d = Math.hypot(it.x - b.pos.x, it.z - b.pos.z);
    if (d < 1.6) {
      const r = tryPickup(b, it);
      if (!r.ok) ai.ignore.add(it);
      ai.goalItem = null;
      return;
    }
    setGoal(b, it.x, it.z);
    ai.sprint = d > 8;
    return;
  }
  // 去下一栋没搜过的房子，或者在圈里闲逛
  ai.wanderT -= 0.25;
  if (!ai.wander || ai.wanderT <= 0 || Math.hypot(ai.wander.x - b.pos.x, ai.wander.z - b.pos.z) < 2) {
    const inB = buildingAt(b.pos.x, b.pos.z, 0);
    if (inB) ai.visited.add(inB);
    let target = null, bd = 160;
    for (const bd0 of W.buildings) {
      if (ai.visited.has(bd0)) continue;
      const d = Math.hypot(bd0.x - b.pos.x, bd0.z - b.pos.z);
      if (d < bd && !outsideZone(bd0.x, bd0.z) && (Z.phase < 0 || insideNext(bd0.x, bd0.z, -20))) { bd = d; target = bd0; }
    }
    if (target) ai.wander = { x: target.x + (Math.random() - 0.5) * 2, z: target.z + (Math.random() - 0.5) * 2 };
    else {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Math.max(10, Z.next.r * 0.7);
      ai.wander = { x: Z.next.x + Math.cos(a) * r, z: Z.next.z + Math.sin(a) * r };
    }
    ai.wanderT = 25;
  }
  setGoal(b, ai.wander.x, ai.wander.z);
  ai.sprint = true;
}

function updateReading(b, dt) {
  const ai = b.ai, t = ai.readTarget;
  if (!t) return;
  if (!t.alive) { ai.readTarget = null; return; }
  const curCode = ai.readPart === 'head' ? t.headCode : t.bodyCode;
  if (curCode !== ai.readCode) { ai.readT = 0; ai.readCode = curCode; }   // 对方数字已重置
  const can = ai.readPart === 'head' ? ai.canHead : ai.canBody;
  if (!can || b.blindT > 0.3 || b.using) {
    ai.readPause += dt;
    if (ai.readPause > 1.4) { ai.readTarget = null; ai.readT = 0; }
    else if (!can && (ai.canBody || ai.canHead)) { ai.readPart = ai.canHead ? 'head' : 'body'; ai.readCode = ai.readPart === 'head' ? t.headCode : t.bodyCode; ai.readT *= 0.4; }
    return;
  }
  ai.readPause = 0;
  if (b.lockT > 0) return;
  ai.readT += dt;
  if (ai.readT >= ai.readNeed) {
    const d = dist2(b, t);
    if (Math.random() < ai.acc) applyHit(b, t, ai.readPart, ai.readWeapon || 'std');
    else b.lockT = 0.8;
    if (t.alive) startRead(b, t, d); else ai.readTarget = null;
  }
}

function steer(b, dt) {
  const ai = b.ai;
  let mx = 0, mz = 0;
  if (!ai.stop && ai.path.length) {
    const wp = ai.path[0];
    const dx = wp.x - b.pos.x, dz = wp.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < (ai.path.length > 1 ? 1.0 : 0.6)) ai.path.shift();
    else { mx = dx / d; mz = dz / d; }
  }
  if (mx || mz) {
    ai.stuckT += dt;
    if (ai.stuckT > 0.7) {
      const moved = Math.hypot(b.pos.x - ai.lastPos.x, b.pos.z - ai.lastPos.z);
      if (moved < 0.4) {
        ai.detour.x = -mz * ai.strafe; ai.detour.z = mx * ai.strafe;
        ai.detourT = 0.5 + Math.random() * 0.7;
        if (b.onGround) b.vel.y = 6.5;
        ai.strafe *= -1;
        if (++ai.stuckCount > 6) { ai.path.length = 0; ai.goal = null; ai.wander = null; ai.goalItem && ai.ignore.add(ai.goalItem); ai.goalItem = null; ai.stuckCount = 0; }
      } else ai.stuckCount = Math.max(0, ai.stuckCount - 1);
      ai.stuckT = 0;
      ai.lastPos.copy(b.pos);
    }
  } else { ai.stuckT = 0; ai.lastPos.copy(b.pos); }
  if (ai.detourT > 0) {
    ai.detourT -= dt;
    mx = ai.detour.x * 0.85 + mx * 0.3; mz = ai.detour.z * 0.85 + mz * 0.3;
    const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
  }
  let speed = ai.stop ? 0 : (ai.sprint ? 6.2 : 4.3);
  if (b.swimming) speed = Math.min(speed, 2.6);
  speed *= b.speedMul();
  const k = Math.min(1, dt * 8);
  b.vel.x += (mx * speed - b.vel.x) * k;
  b.vel.z += (mz * speed - b.vel.z) * k;
  // 朝向
  let ty = null;
  if (ai.faceAt) ty = Math.atan2(-(ai.faceAt.x - b.pos.x), -(ai.faceAt.z - b.pos.z));
  else if (ai.faceAway) ty = Math.atan2((ai.faceAway.x - b.pos.x), (ai.faceAway.z - b.pos.z));
  else if (Math.hypot(b.vel.x, b.vel.z) > 0.5) ty = Math.atan2(-b.vel.x, -b.vel.z);
  if (ty != null) {
    const dyaw = angleDiff(b.yaw, ty);
    const rate = (4 + ai.skill * 3) * dt;
    b.yaw += clamp(dyaw, -rate, rate);
  }
}
