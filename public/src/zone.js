// 缩圈
import * as THREE from 'three';
import { G } from './state.js';
import { ZONE_PHASES, ZONE_R0 } from './config.js';
import { heightAt } from './world.js';

export const Z = {
  phase: -1,      // 当前所处阶段（-1 = 尚未开始第一阶段）
  state: 'wait',  // wait | shrink | done
  timer: 0,
  cur: { x: 0, z: 0, r: ZONE_R0 },
  from: { x: 0, z: 0, r: ZONE_R0 },
  next: { x: 0, z: 0, r: ZONE_R0 },
  dps: 0,
  mesh: null,
  tex: null,
};

function pickNext(cur, r) {
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * Math.max(0, cur.r - r);
    const x = cur.x + Math.cos(a) * d, z = cur.z + Math.sin(a) * d;
    if (heightAt(x, z) > 1.5 || i === 39) return { x, z, r };
  }
  return { x: cur.x, z: cur.z, r };
}

export function initZoneMesh(scene) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(70,130,255,0.55)';
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = 'rgba(190,215,255,0.9)';
  for (let y = 0; y < 256; y += 32) ctx.fillRect(0, y, 64, 5);
  // 自下而上渐隐
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
  Z.tex = new THREE.CanvasTexture(c);
  Z.tex.wrapS = Z.tex.wrapT = THREE.RepeatWrapping;
  Z.tex.repeat.set(60, 1);
  const geo = new THREE.CylinderGeometry(1, 1, 240, 128, 1, true);
  geo.translate(0, 90, 0);
  Z.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: Z.tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  Z.mesh.renderOrder = 2;
  scene.add(Z.mesh);
  Z.mesh.visible = false;
}

export function resetZone() {
  Z.phase = -1;
  Z.state = 'wait';
  Z.cur = { x: 0, z: 0, r: ZONE_R0 };
  Z.from = { ...Z.cur };
  Z.next = pickNext(Z.cur, ZONE_PHASES[0].r);
  Z.timer = ZONE_PHASES[0].wait;
  Z.dps = 0;
  Z.mesh.visible = true;
}

export function updateZone(dt) {
  Z.timer -= dt;
  if (Z.state === 'wait') {
    if (Z.timer <= 0) {
      Z.phase++;
      if (Z.phase >= ZONE_PHASES.length) { Z.state = 'done'; Z.phase = ZONE_PHASES.length - 1; }
      else {
        const P = ZONE_PHASES[Z.phase];
        Z.state = 'shrink';
        Z.timer = P.shrink;
        Z.from = { ...Z.cur };
        Z.dps = P.dps;
        G.hooks.onZone && G.hooks.onZone('shrink', Z.phase);
      }
    }
  } else if (Z.state === 'shrink') {
    const P = ZONE_PHASES[Z.phase];
    const t = 1 - Math.max(0, Z.timer) / P.shrink;
    Z.cur.x = Z.from.x + (Z.next.x - Z.from.x) * t;
    Z.cur.z = Z.from.z + (Z.next.z - Z.from.z) * t;
    Z.cur.r = Z.from.r + (Z.next.r - Z.from.r) * t;
    if (Z.timer <= 0) {
      Z.cur = { ...Z.next };
      const NP = ZONE_PHASES[Z.phase + 1];
      if (NP) {
        Z.state = 'wait';
        Z.timer = NP.wait;
        Z.next = pickNext(Z.cur, NP.r);
        G.hooks.onZone && G.hooks.onZone('wait', Z.phase + 1);
      } else {
        Z.state = 'done';
      }
    }
  }
  if (Z.mesh) {
    Z.mesh.position.set(Z.cur.x, -20, Z.cur.z);
    const r = Math.max(0.5, Z.cur.r);
    Z.mesh.scale.set(r, 1, r);
    Z.tex.repeat.x = Math.max(4, Math.round(r / 10));
  }
}

export function outsideZone(x, z) {
  return Math.hypot(x - Z.cur.x, z - Z.cur.z) > Z.cur.r;
}
export function insideNext(x, z, margin = 0) {
  return Math.hypot(x - Z.next.x, z - Z.next.z) < Z.next.r - margin;
}
