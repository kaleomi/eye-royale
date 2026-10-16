// 玩家输入、移动与镜头
import * as THREE from 'three';
import { G } from './state.js';
import { moveActor, groundAt } from './physics.js';
import { P, canDrop } from './plane.js';
import { nearestItem, tryPickup, throwNade } from './items.js';
import { playerSubmit } from './combat.js';
import { sfx, setAmbience } from './audio.js';
import { WATER_LEVEL, ITEM_DEFS, WEAPONS } from './config.js';
import { clamp } from './util.js';

export const input = {
  keys: {}, mdx: 0, mdy: 0, ads: false, locked: false, dragging: false, jump: false,
  scopeSel: 0, // 0 = 不用倍镜（眯眼），否则为倍率
};
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), camDir = new THREE.Vector3();
let bobPhase = 0;
let canvasEl = null;

const DIGIT = {};
for (let i = 0; i < 10; i++) { DIGIT['Digit' + i] = String(i); DIGIT['Numpad' + i] = String(i); }

// ---------- 鼠标锁定与视角 ----------
// 已知问题：Chrome（尤其 Windows / 高刷屏 / 刚锁定鼠标时）偶尔会给出一次巨大的 movementX，
// 视角就会瞬间转半圈。这里做三层处理：
// 1. 优先请求原始输入（unadjustedMovement），绕开系统鼠标加速，跳变基本消失；
// 2. 锁定后的前 150ms 丢弃所有位移（锁定瞬间最容易出现跳变）；
// 3. 单次位移远超最近平均值的事件视为跳变丢弃。
let lockWorked = false, lockFails = 0, ignoreUntil = 0, avgMove = 8;

function lockFailed(err) {
  lockFails++;
  // 只有从来没锁成功过、且连续失败时，才认为页面不支持锁定，改用拖动转视角
  if (!lockWorked && (lockFails >= 2 || (err && err.name === 'NotSupportedError'))) {
    G.dragLook = true;
    G.hooks.onDragMode && G.hooks.onDragMode();
  } else {
    G.hooks.toast && G.hooks.toast('点击画面锁定鼠标', 'warn');
  }
}

export function requestLock() {
  if (G.dragLook || !canvasEl || document.pointerLockElement === canvasEl) return;
  let r;
  try { r = canvasEl.requestPointerLock({ unadjustedMovement: true }); }
  catch (e) { r = null; }
  if (r && r.catch) {
    r.catch(err => {
      if (err && err.name === 'NotSupportedError') {
        // 浏览器不支持原始输入，退回普通锁定
        try {
          const r2 = canvasEl.requestPointerLock();
          if (r2 && r2.catch) r2.catch(lockFailed);
        } catch (e) { lockFailed(e); }
      } else lockFailed(err);
    });
  } else if (!r) {
    try { canvasEl.requestPointerLock(); } catch (e) { lockFailed(e); }
  }
}

function onMouseMove(e) {
  if (G.mode !== 'match' || G.paused) return;
  const dx = e.movementX || 0, dy = e.movementY || 0;
  if (input.locked) {
    if (performance.now() < ignoreUntil) return;
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    if (m > 160 && m > avgMove * 7) return;      // 异常跳变，丢弃
    avgMove = avgMove * 0.85 + m * 0.15;
    if (avgMove < 4) avgMove = 4;
    input.mdx += dx; input.mdy += dy;
  } else if (G.dragLook && input.dragging) {
    if (Math.abs(dx) > 300 || Math.abs(dy) > 300) return;
    input.mdx += dx; input.mdy += dy;
  }
}

export function initInput(canvas) {
  canvasEl = canvas;
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => { input.keys[e.code] = false; });
  window.addEventListener('blur', () => { input.keys = {}; input.ads = false; input.mdx = input.mdy = 0; });
  canvas.addEventListener('mousedown', e => {
    if (G.mode !== 'match' || G.paused) return;
    if (e.button === 0) {
      if (G.dragLook) input.dragging = true;
      else if (!input.locked) requestLock();
    } else if (e.button === 2) {
      input.ads = true;
    }
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) input.dragging = false;
    if (e.button === 2) input.ads = false;
  });
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    input.mdx = input.mdy = 0;
    if (input.locked) { lockWorked = true; lockFails = 0; ignoreUntil = performance.now() + 150; avgMove = 8; }
    if (!input.locked && G.mode === 'match' && !G.dragLook && G.player && G.player.alive) G.hooks.onUnlock && G.hooks.onUnlock();
  });
  document.addEventListener('pointerlockerror', () => lockFailed(null));
  canvas.addEventListener('wheel', e => {
    if (G.mode !== 'match') return;
    e.preventDefault();
    cycleScope(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

export function scopeList() {
  return [0, ...[...G.player.scopes].sort((a, b) => a - b)];
}
export function cycleScope(dir) {
  const l = scopeList();
  let i = l.indexOf(input.scopeSel);
  if (i < 0) i = 0;
  i = (i + dir + l.length) % l.length;
  input.scopeSel = l[i];
  G.hooks.onScopeChange && G.hooks.onScopeChange(input.scopeSel);
}

function onKey(e) {
  if (G.mode !== 'match') return;
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  const code = e.code;
  if (code === 'Tab' || code === 'Space' || code === 'Backspace' || code === 'Slash' || code === 'Quote') e.preventDefault();
  if (code === 'Escape') { if (G.dragLook || !input.locked) G.hooks.togglePause && G.hooks.togglePause(); return; }
  if (G.paused) return;
  input.keys[code] = true;
  if (e.repeat) return;
  const p = G.player;
  if (DIGIT[code]) { typeDigit(DIGIT[code]); return; }
  switch (code) {
    case 'Backspace': if (G.codeBuf) { G.codeBuf = ''; sfx.clear(); } break;
    case 'KeyF': interact(); break;
    case 'Space': input.jump = true; break;
    case 'KeyC': p.crouch = !p.crouch; break;
    case 'KeyZ': useItem('bandage'); break;
    case 'KeyX': useItem('firstaid'); break;
    case 'KeyV': useItem('medkit'); break;
    case 'KeyB': useItem('drink'); break;
    case 'KeyT': useItem('camo'); break;
    case 'KeyQ': throwKind('flash'); break;
    case 'KeyE': throwKind('smoke'); break;
    case 'Tab': G.hooks.toggleInv && G.hooks.toggleInv(); break;
    case 'KeyM': G.hooks.toggleMap && G.hooks.toggleMap(); break;
    case 'KeyR': cycleWeapon(1); break;
  }
}

export function cycleWeapon(dir) {
  const p = G.player;
  if (!p || !p.alive) return;
  const l = p.weaponList();
  if (l.length <= 1) { G.hooks.toast && G.hooks.toast('只有标准读码 · 搜到读码卡后按 R 切换', 'warn'); return; }
  let i = l.indexOf(p.weapon);
  p.weapon = l[(i + dir + l.length) % l.length];
  if (G.codeBuf) G.codeBuf = '';
  sfx.clear();
  G.hooks.onWeaponChange && G.hooks.onWeaponChange(p.weapon);
}

export function typeDigit(d) {
  const p = G.player;
  if (!p || !p.alive || (p.state !== 'ground' && p.state !== 'chute')) return;
  if (p.lockT > 0) { G.hooks.onLockedType && G.hooks.onLockedType(); return; }
  const W = WEAPONS[p.weapon];
  if (W.scope && zoomFactor() < W.scope) {
    G.hooks.toast && G.hooks.toast(`${W.name}要先开 ${W.scope} 倍以上的镜（右键）`, 'warn');
    sfx.deny();
    return;
  }
  G.codeBuf += d;
  sfx.key();
  if (G.codeBuf.length >= W.len) {
    const c = G.codeBuf;
    G.codeBuf = '';
    G.lastCode = c; G.lastCodeT = G.time;
    playerSubmit(c, zoomFactor());
  }
}

export function useItem(key) {
  const p = G.player;
  if (!p.alive || p.state !== 'ground') return;
  const r = p.startUse(key);
  if (r) { G.hooks.toast && G.hooks.toast(r, 'warn'); sfx.deny(); }
  else sfx.use();
}

export function throwKind(kind) {
  const p = G.player;
  if (!p.alive || p.state !== 'ground') return;
  if (p.inv[kind] <= 0) { G.hooks.toast && G.hooks.toast('没有' + ITEM_DEFS[kind].name, 'warn'); sfx.deny(); return; }
  G.camera.getWorldDirection(camDir);
  throwNade(p, kind, camDir);
}

function interact() {
  const p = G.player;
  if (!p.alive) return;
  if (p.state === 'plane') {
    if (canDrop()) jumpOut(p);
    else G.hooks.toast && G.hooks.toast('还没飞到岛屿上空', 'warn');
  } else if (p.state === 'fall') {
    openChute(p);
  } else if (p.state === 'ground') {
    p.forward(fwd);
    const it = nearestItem(p, 2.6, fwd);
    if (!it) return;
    const r = tryPickup(p, it);
    if (r.ok) { sfx.pickup(); if (ITEM_DEFS[it.key].cat === 'scope') input.scopeSel = p.bestScope(); }
    else sfx.deny();
    if (r.msg) G.hooks.toast && G.hooks.toast(r.msg, r.ok ? 'ok' : 'warn');
  }
}

function jumpOut(p) {
  p.state = 'fall';
  p.pos.copy(P.pos); p.pos.y -= 5;
  p.vel.set(P.dir.x * 20, -10, P.dir.z * 20);
  setAmbience('fall');
  G.hooks.onJump && G.hooks.onJump();
}

function openChute(p) {
  p.state = 'chute';
  sfx.chute();
  setAmbience('chute');
}

function agl(p) {
  let g = groundAt(p.pos.x, p.pos.z, p.pos.y);
  if (g < WATER_LEVEL - 1.25) g = WATER_LEVEL - 1.25;
  return [p.pos.y - g, g];
}

export function playerAGL() { return agl(G.player)[0]; }

export function zoomFactor() {
  if (!input.ads || G.player.state !== 'ground' && G.player.state !== 'chute') return 1;
  return input.scopeSel || 1.3;
}

export function updatePlayer(dt) {
  const p = G.player, cam = G.camera, k = input.keys;
  const fovK = cam.fov / 75;
  const sens = 0.0022 * G.settings.sens * fovK;
  p.yaw -= input.mdx * sens;
  p.pitch -= input.mdy * sens;
  input.mdx = input.mdy = 0;
  p.pitch = clamp(p.pitch, -1.52, 1.52);

  if (!p.alive) {
    const a = G.time * 0.25;
    cam.position.set(p.pos.x + Math.cos(a) * 8, p.pos.y + 4.5, p.pos.z + Math.sin(a) * 8);
    cam.lookAt(p.pos.x, p.pos.y + 0.8, p.pos.z);
    setFov(cam, 70, dt);
    return;
  }

  p.forward(fwd);
  right.set(-fwd.z, 0, fwd.x);
  let ix = 0, iz = 0;
  if (k.KeyW) iz += 1;
  if (k.KeyS) iz -= 1;
  if (k.KeyD) ix += 1;
  if (k.KeyA) ix -= 1;

  let fovBase = 75;
  if (p.state === 'plane') {
    p.pos.copy(P.pos);
    if (P.t > 0.93 || !P.active) jumpOut(p);
    // 跟随视角
    const cp = Math.cos(p.pitch);
    const dx = -Math.sin(p.yaw) * cp, dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * cp;
    cam.position.set(P.pos.x - dx * 46, P.pos.y - dy * 46 + 7, P.pos.z - dz * 46);
    cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    setFov(cam, 70, dt);
    return;
  }
  if (p.state === 'fall') {
    const dive = iz > 0 && p.pitch < -0.6;
    const hs = iz > 0 ? 26 : iz < 0 ? -6 : 6;
    const tvx = fwd.x * hs + right.x * ix * 10, tvz = fwd.z * hs + right.z * ix * 10;
    const tvy = dive ? -58 : -46;
    const kk = Math.min(1, dt * 2);
    p.vel.x += (tvx - p.vel.x) * kk; p.vel.z += (tvz - p.vel.z) * kk; p.vel.y += (tvy - p.vel.y) * kk;
    p.pos.addScaledVector(p.vel, dt);
    const [h] = agl(p);
    if (h < 100) openChute(p);
    fovBase = 85;
  } else if (p.state === 'chute') {
    const hs = iz > 0 ? 13 : iz < 0 ? 3 : 7.5;
    const tvx = fwd.x * hs + right.x * ix * 6, tvz = fwd.z * hs + right.z * ix * 6;
    const tvy = iz > 0 ? -7.5 : iz < 0 ? -4 : -5.5;
    const kk = Math.min(1, dt * 1.5);
    p.vel.x += (tvx - p.vel.x) * kk; p.vel.z += (tvz - p.vel.z) * kk; p.vel.y += (tvy - p.vel.y) * kk;
    p.pos.addScaledVector(p.vel, dt);
    const [h, g] = agl(p);
    if (h <= 0) {
      p.pos.y = g; p.vel.set(0, 0, 0);
      p.state = 'ground'; p.onGround = true;
      sfx.land(); setAmbience('ground');
      G.hooks.onLand && G.hooks.onLand();
    }
  } else if (p.state === 'ground') {
    const sprint = k.ShiftLeft && iz > 0 && !input.ads && !p.crouch && !p.using;
    let speed = p.crouch ? 2.2 : sprint ? 6.4 : 4.6;
    if (input.ads) speed = Math.min(speed, 3.2);
    if (p.swimming) speed = 2.6;
    speed *= p.speedMul();
    let wx = fwd.x * iz + right.x * ix, wz = fwd.z * iz + right.z * ix;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const kk = Math.min(1, dt * (p.onGround ? 11 : 2.5));
    p.vel.x += (wx * speed - p.vel.x) * kk;
    p.vel.z += (wz * speed - p.vel.z) * kk;
    if (input.jump && (p.onGround || p.swimming)) { p.vel.y = 6.6; p.onGround = false; if (p.crouch) p.crouch = false; }
    moveActor(p, dt);
    const hs = Math.hypot(p.vel.x, p.vel.z);
    if (p.onGround && hs > 0.5) bobPhase += hs * dt * 1.9;
  }
  input.jump = false;

  // 镜头
  const zf = zoomFactor();
  let bob = p.state === 'ground' ? Math.sin(bobPhase * 2) * 0.035 * (zf > 1 ? 0.2 : 1) : 0;
  cam.position.set(p.pos.x, p.eyeY() + bob, p.pos.z);
  let sy = 0, sp = 0;
  if (zf >= 4 && !k.ShiftLeft) {
    const amp = 0.0011 * zf * (p.crouch ? 0.5 : 1);
    sy = Math.sin(G.time * 1.1) * amp; sp = Math.sin(G.time * 1.7 + 1) * amp * 0.8;
  }
  cam.rotation.set(p.pitch + sp, p.yaw + sy, 0, 'YXZ');
  const target = zf > 1 ? 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fovBase / 2)) / zf) * 180 / Math.PI : fovBase;
  setFov(cam, target, dt);
}

function setFov(cam, target, dt) {
  if (Math.abs(cam.fov - target) > 0.01) {
    cam.fov += (target - cam.fov) * Math.min(1, dt * 16);
    cam.updateProjectionMatrix();
  }
}
