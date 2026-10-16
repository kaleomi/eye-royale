// 角色移动与碰撞
import { heightAt, forEachNear } from './world.js';
import { WATER_LEVEL, MAP_HALF, GRAVITY } from './config.js';
import { clamp } from './util.js';

const STEP_UP = 0.55;
const SWIM_Y = WATER_LEVEL - 1.25;

export function groundAt(x, z, y) {
  let g = heightAt(x, z);
  forEachNear(x, z, x, z, o => {
    if (o.t === 0 && x >= o.minX && x <= o.maxX && z >= o.minZ && z <= o.maxZ && o.maxY <= y + STEP_UP && o.maxY > g) g = o.maxY;
  });
  return g;
}

// 只算地面（含屋顶/地板），不含水面
export function solidGroundAt(x, z, y) { return groundAt(x, z, y); }

export function pushOut(a, r, hgt) {
  const px = a.pos.x, pz = a.pos.z;
  forEachNear(px - r - 0.5, pz - r - 0.5, px + r + 0.5, pz + r + 0.5, o => {
    if (o.t === 0) {
      if (o.maxY <= a.pos.y + STEP_UP || o.minY >= a.pos.y + hgt) return;
      const cx = clamp(a.pos.x, o.minX, o.maxX), cz = clamp(a.pos.z, o.minZ, o.maxZ);
      const dx = a.pos.x - cx, dz = a.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        a.pos.x += dx * push; a.pos.z += dz * push;
      } else {
        const pl = a.pos.x - o.minX, pr = o.maxX - a.pos.x, pb = a.pos.z - o.minZ, pf = o.maxZ - a.pos.z;
        const m = Math.min(pl, pr, pb, pf);
        if (m === pl) a.pos.x = o.minX - r; else if (m === pr) a.pos.x = o.maxX + r;
        else if (m === pb) a.pos.z = o.minZ - r; else a.pos.z = o.maxZ + r;
      }
      a.blocked = true;
    } else if (o.t === 1) {
      if (o.y1 <= a.pos.y + STEP_UP || o.y0 >= a.pos.y + hgt) return;
      const dx = a.pos.x - o.x, dz = a.pos.z - o.z;
      const d2 = dx * dx + dz * dz, rr = r + o.r;
      if (d2 < rr * rr && d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (rr - d) / d;
        a.pos.x += dx * push; a.pos.z += dz * push;
        a.blocked = true;
      }
    }
  });
}

export function moveActor(a, dt) {
  const r = 0.36, hgt = a.crouch ? 1.35 : 1.95;
  a.blocked = false;
  // 分步移动，避免高速穿墙
  const sub = Math.max(1, Math.ceil(Math.hypot(a.vel.x, a.vel.z) * dt / 0.3));
  for (let s = 0; s < sub; s++) {
    a.pos.x += a.vel.x * dt / sub;
    a.pos.z += a.vel.z * dt / sub;
    pushOut(a, r, hgt);
  }
  const B = MAP_HALF - 2;
  a.pos.x = clamp(a.pos.x, -B, B);
  a.pos.z = clamp(a.pos.z, -B, B);

  a.vel.y -= GRAVITY * dt;
  if (a.vel.y < -60) a.vel.y = -60;
  a.pos.y += a.vel.y * dt;
  let g = groundAt(a.pos.x, a.pos.z, a.pos.y);
  a.swimming = false;
  if (g < SWIM_Y) { g = SWIM_Y; a.swimming = a.pos.y < SWIM_Y + 0.4; }
  if (a.pos.y <= g) {
    a.pos.y = g;
    if (a.vel.y < 0) a.vel.y = 0;
    a.onGround = true;
  } else if (a.onGround && a.vel.y <= 0 && a.pos.y - g < 0.65) {
    a.pos.y = g; a.vel.y = 0;
  } else {
    a.onGround = false;
  }
  if (g === SWIM_Y && a.pos.y <= SWIM_Y + 0.01) a.swimming = true;
}
