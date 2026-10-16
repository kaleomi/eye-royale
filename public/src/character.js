// 角色模型：胸前与额头的数字牌、装备外观、动作
import * as THREE from 'three';
import { G } from './state.js';
import { ITEM_DEFS } from './config.js';

const S = {};
function shared() {
  if (S.ready) return S;
  S.leg = new THREE.BoxGeometry(0.24, 0.85, 0.26).translate(0, -0.425, 0);
  S.arm = new THREE.BoxGeometry(0.18, 0.72, 0.2).translate(0, -0.36, 0);
  S.torso = new THREE.BoxGeometry(0.72, 0.72, 0.36);
  S.head = new THREE.BoxGeometry(0.42, 0.4, 0.4);
  S.chest = new THREE.PlaneGeometry(0.68, 0.38);
  S.face = new THREE.PlaneGeometry(0.38, 0.15);
  S.eye = new THREE.BoxGeometry(0.07, 0.05, 0.02);
  S.helmet = new THREE.BoxGeometry(0.48, 0.16, 0.46);
  S.helmetBack = new THREE.BoxGeometry(0.48, 0.2, 0.08);
  S.vest = new THREE.BoxGeometry(0.8, 0.58, 0.42);
  S.bag = new THREE.BoxGeometry(0.5, 0.56, 1).translate(0, 0, 0.5);
  S.chute = new THREE.SphereGeometry(3.6, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2.5);
  S.line = new THREE.CylinderGeometry(0.01, 0.01, 1, 3).translate(0, 0.5, 0);
  S.skin = new THREE.MeshLambertMaterial({ color: 0xe0b48a });
  S.dark = new THREE.MeshLambertMaterial({ color: 0x1d1d1d });
  S.pants = new THREE.MeshLambertMaterial({ color: 0x3b3f46 });
  S.bagMat = new THREE.MeshLambertMaterial({ color: 0x6b5a3a });
  S.lineMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
  S.gear = [null, 1, 2, 3].map(l => l && new THREE.MeshLambertMaterial({ color: ITEM_DEFS['helmet' + l].color }));
  S.vestMat = [null, 1, 2, 3].map(l => l && new THREE.MeshLambertMaterial({ color: new THREE.Color(ITEM_DEFS['armor' + l].color).multiplyScalar(0.8) }));
  S.ready = true;
  return S;
}

export function createCharacter(color) {
  shared();
  const root = new THREE.Group();
  const upper = new THREE.Group();
  root.add(upper);
  const shirt = new THREE.MeshLambertMaterial({ color });
  const torso = new THREE.Mesh(S.torso, shirt); torso.position.y = 1.21; upper.add(torso);
  const head = new THREE.Mesh(S.head, S.skin); head.position.y = 1.78; upper.add(head);
  for (const sx of [-0.1, 0.1]) {
    const e = new THREE.Mesh(S.eye, S.dark); e.position.set(sx, 1.73, -0.205); upper.add(e);
  }
  const arms = [];
  for (const sx of [-0.46, 0.46]) {
    const p = new THREE.Group(); p.position.set(sx, 1.52, 0);
    p.add(new THREE.Mesh(S.arm, shirt)); upper.add(p); arms.push(p);
  }
  const legs = [];
  for (const sx of [-0.16, 0.16]) {
    const p = new THREE.Group(); p.position.set(sx, 0.85, 0);
    p.add(new THREE.Mesh(S.leg, S.pants)); root.add(p); legs.push(p);
  }
  // 数字牌
  const bodyCanvas = document.createElement('canvas'); bodyCanvas.width = 256; bodyCanvas.height = 144;
  const headCanvas = document.createElement('canvas'); headCanvas.width = 192; headCanvas.height = 76;
  const bodyTex = new THREE.CanvasTexture(bodyCanvas), headTex = new THREE.CanvasTexture(headCanvas);
  for (const t of [bodyTex, headTex]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = G.maxAniso; }
  const chest = new THREE.Mesh(S.chest, new THREE.MeshBasicMaterial({ map: bodyTex }));
  chest.position.set(0, 1.24, -0.225); chest.rotation.y = Math.PI; upper.add(chest);
  const face = new THREE.Mesh(S.face, new THREE.MeshBasicMaterial({ map: headTex }));
  face.position.set(0, 1.865, -0.205); face.rotation.y = Math.PI; upper.add(face);
  // 装备
  const helmet = new THREE.Group();
  const hTop = new THREE.Mesh(S.helmet, S.gear[1]); hTop.position.set(0, 2.02, 0.01);
  const hBack = new THREE.Mesh(S.helmetBack, S.gear[1]); hBack.position.set(0, 1.9, 0.22);
  helmet.add(hTop, hBack); helmet.visible = false; upper.add(helmet);
  const vest = new THREE.Mesh(S.vest, S.vestMat[1]); vest.position.y = 1.2; vest.visible = false; upper.add(vest);
  const bag = new THREE.Mesh(S.bag, S.bagMat); bag.position.set(0, 1.25, 0.19); bag.visible = false; upper.add(bag);
  // 降落伞
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(S.chute, new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.65, 0.55), side: THREE.DoubleSide }));
  canopy.position.y = 4.2; canopy.scale.set(1, 0.6, 1.25);
  chute.add(canopy);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const l = new THREE.Mesh(S.line, S.lineMat);
    l.position.set(lx * 0.3, 1.6, lz * 0.2);
    const top = new THREE.Vector3(lx * 2.9, 4.4, lz * 3.4);
    const dir = top.clone().sub(l.position);
    l.scale.y = dir.length();
    l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    chute.add(l);
  }
  chute.visible = false;
  root.add(chute);

  return { root, upper, arms, legs, bodyCanvas, headCanvas, bodyTex, headTex, helmet, hTop, hBack, vest, bag, chute, phase: 0, deadT: 0, camoFlick: 0 };
}

function drawPlate(canvas, code, camo) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#f3efe4';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = Math.max(3, h * 0.06);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  ctx.fillStyle = '#111';
  const fs = Math.floor(h * 0.86);
  ctx.font = `bold ${fs}px Consolas, "DejaVu Sans Mono", "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cw = w / 4.2;
  const gw = ctx.measureText('0').width || fs * 0.6;
  const sx = Math.min(1, (cw * 0.94) / gw);
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate(w / 2 + (i - 1.5) * cw, h * 0.54);
    ctx.scale(sx, 1);
    ctx.fillText(code[i], 0, 0);
    ctx.restore();
  }
  if (camo) {
    // 干扰涂层：杂线 + 假数字 + 降低对比
    ctx.fillStyle = 'rgba(150,120,170,0.38)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = `rgba(${20 + Math.random() * 80},${20 + Math.random() * 60},${40 + Math.random() * 80},0.8)`;
      ctx.lineWidth = 1 + Math.random() * h * 0.05;
      ctx.beginPath();
      ctx.moveTo(Math.random() * w, Math.random() * h);
      ctx.lineTo(Math.random() * w, Math.random() * h);
      ctx.stroke();
    }
    ctx.font = `bold ${Math.floor(h * 0.5)}px Consolas, monospace`;
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(30,20,40,${0.35 + Math.random() * 0.3})`;
      ctx.fillText(String(Math.floor(Math.random() * 10)), Math.random() * w, Math.random() * h);
    }
  }
}

export function drawCodes(ch, bodyCode, headCode, camo) {
  drawPlate(ch.bodyCanvas, bodyCode, camo);
  drawPlate(ch.headCanvas, headCode, camo);
  ch.bodyTex.needsUpdate = true;
  ch.headTex.needsUpdate = true;
}

export function updateGear(ch, a) {
  ch.helmet.visible = !!a.helmet;
  if (a.helmet) { ch.hTop.material = S.gear[a.helmet.lvl]; ch.hBack.material = S.gear[a.helmet.lvl]; }
  ch.vest.visible = !!a.armor;
  if (a.armor) ch.vest.material = S.vestMat[a.armor.lvl];
  ch.bag.visible = a.bag > 0;
  if (a.bag > 0) ch.bag.scale.z = 0.14 + a.bag * 0.08;
}

export function animateCharacter(ch, a, dt) {
  const r = ch.root;
  r.position.copy(a.pos);
  r.rotation.y = a.yaw;
  ch.chute.visible = a.state === 'chute';
  if (!a.alive) {
    ch.deadT += dt;
    r.rotation.x = Math.max(-Math.PI / 2, -ch.deadT * 4);
    r.position.y = a.pos.y + 0.2;
    return;
  }
  if (a.state === 'fall') {
    r.rotation.x = -1.25;
    ch.legs.forEach((l, i) => (l.rotation.x = Math.sin(G.time * 6 + i) * 0.2));
    ch.arms.forEach((l, i) => { l.rotation.x = 0; l.rotation.z = (i ? -1 : 1) * 1.2; });
    return;
  }
  r.rotation.x = 0;
  ch.arms.forEach(l => (l.rotation.z = 0));
  const sp = Math.hypot(a.vel.x, a.vel.z);
  const crouch = a.crouch && a.state === 'ground';
  ch.upper.position.y = crouch ? -0.42 : 0;
  ch.legs.forEach(l => { l.position.y = crouch ? 0.43 : 0.85; l.scale.y = crouch ? 0.5 : 1; });
  if (a.state === 'chute') {
    ch.legs.forEach((l, i) => (l.rotation.x = Math.sin(G.time * 2 + i * 2) * 0.15));
    ch.arms.forEach(l => (l.rotation.x = Math.PI * 0.9));
    return;
  }
  ch.phase += sp * dt * 2.1;
  const amp = Math.min(1, sp / 4) * 0.7;
  const sw = Math.sin(ch.phase) * amp;
  ch.legs[0].rotation.x = sw; ch.legs[1].rotation.x = -sw;
  if (a.using) {
    ch.arms[0].rotation.x = -1.1; ch.arms[1].rotation.x = -1.1;
  } else {
    ch.arms[0].rotation.x = -sw * 0.8; ch.arms[1].rotation.x = sw * 0.8;
  }
}
