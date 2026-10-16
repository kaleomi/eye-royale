// 运输机航线
import * as THREE from 'three';
import { PLANE_ALT, MAP_HALF } from './config.js';

export const P = {
  start: new THREE.Vector3(),
  end: new THREE.Vector3(),
  pos: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  t: 0,          // 0..1
  dur: 26,
  active: false,
  mesh: null,
};

export function initPlaneMesh(scene) {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0x7c8a7a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3f4a42 });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.6, 26, 12).rotateX(Math.PI / 2), body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), body); nose.position.z = -13; nose.scale.z = 1.6;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(34, 0.5, 4.5), dark); wing.position.set(0, 1.2, -2);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(11, 0.4, 2.5), dark); tail.position.set(0, 1.0, 12);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 3), dark); fin.position.set(0, 3.5, 12);
  g.add(fus, nose, wing, tail, fin);
  for (const x of [-9, -5, 5, 9]) {
    const e = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3, 10).rotateX(Math.PI / 2), dark);
    e.position.set(x, 0.6, -3.5);
    g.add(e);
  }
  g.visible = false;
  scene.add(g);
  P.mesh = g;
}

export function startPlane() {
  const a = Math.random() * Math.PI * 2;
  const off = (Math.random() - 0.5) * 300;
  const perp = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  P.start.set(Math.cos(a) * 760, PLANE_ALT, Math.sin(a) * 760).addScaledVector(perp, off);
  P.end.set(-Math.cos(a) * 760, PLANE_ALT, -Math.sin(a) * 760).addScaledVector(perp, off);
  P.dir.copy(P.end).sub(P.start).normalize();
  P.t = 0;
  P.active = true;
  P.dur = P.start.distanceTo(P.end) / 58;
  P.pos.copy(P.start);
  P.mesh.visible = true;
  P.mesh.position.copy(P.pos);
  P.mesh.lookAt(P.pos.clone().sub(P.dir));
}

export function updatePlane(dt) {
  if (!P.active) return;
  P.t += dt / P.dur;
  P.pos.lerpVectors(P.start, P.end, Math.min(1, P.t));
  P.mesh.position.copy(P.pos);
  if (P.t >= 1.08) { P.active = false; P.mesh.visible = false; }
}

export function canDrop() {
  return P.active && Math.abs(P.pos.x) < MAP_HALF - 40 && Math.abs(P.pos.z) < MAP_HALF - 40;
}

// 航线上离某点最近的位置参数
export function pathParamNear(x, z) {
  const dx = P.end.x - P.start.x, dz = P.end.z - P.start.z;
  return ((x - P.start.x) * dx + (z - P.start.z) * dz) / (dx * dx + dz * dz);
}
