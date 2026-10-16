// 玩家与机器人共用的角色数据
import * as THREE from 'three';
import { G } from './state.js';
import { ITEM_DEFS, ARMOR_REDUCE, ARMOR_DURA, BAG_CAP, HP_MAX, CONSUMABLES, DMG_HEAD, DMG_BODY } from './config.js';
import { randCode } from './util.js';
import { createCharacter, drawCodes, updateGear } from './character.js';

let nextId = 1;

export class Actor {
  constructor(name, isPlayer, color) {
    this.id = nextId++;
    this.name = name;
    this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.hp = HP_MAX;
    this.boost = 0;
    this.alive = true;
    this.state = 'plane';
    this.helmet = null;
    this.armor = null;
    this.bag = 0;
    this.scopes = new Set();
    this.scanner = false;
    this.inv = {};
    for (const k of CONSUMABLES) this.inv[k] = 0;
    this.camoT = 0; this.camoRedraw = 0;
    this.blindT = 0; this.blindMax = 1;
    this.lockT = 0; this.missStreak = 0; this.missDecay = 0;
    this.using = null;
    this.throwCd = 0;
    this.kills = 0;
    this.dmgDealt = 0;
    this.crouch = false;
    this.onGround = false;
    this.swimming = false;
    this.reveal = new Map();     // viewerId -> 剩余显示时间（被谁扫描出来）
    this.scanProg = new Map();   // targetId -> 扫描进度（我在扫描谁）
    this.deathTime = 0;
    this.place = 0;
    this.zoneTick = 0;
    this.char = createCharacter(color);
    this.char.root.visible = false;
    G.scene.add(this.char.root);
    this.resetCodes();
  }

  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  eyeY() { return this.pos.y + (this.crouch && this.state === 'ground' ? 1.33 : 1.75); }
  chestY() { return this.pos.y + (this.crouch && this.state === 'ground' ? 0.8 : 1.22); }

  resetCodes() {
    const b = randCode();
    let h = randCode();
    while (h === b) h = randCode();
    this.bodyCode = b; this.headCode = h;
    this.reveal.clear();
    for (const v of G.actors) v.scanProg.delete(this.id);
    drawCodes(this.char, b, h, this.camoT > 0);
  }

  capacity() { return BAG_CAP[this.bag]; }
  invWeight() {
    let w = 0;
    for (const k of CONSUMABLES) w += this.inv[k] * ITEM_DEFS[k].weight;
    return w;
  }
  bestScope() { let z = 1; for (const s of this.scopes) if (s > z) z = s; return z; }
  refreshGear() { updateGear(this.char, this); }

  // 被读码命中
  takeHit(part, attacker) {
    const base = part === 'head' ? DMG_HEAD : DMG_BODY;
    const slot = part === 'head' ? 'helmet' : 'armor';
    const gear = this[slot];
    let dmg = base, broke = false;
    if (gear) {
      dmg = base * (1 - ARMOR_REDUCE[gear.lvl]);
      gear.dura -= base * 0.6;
      if (gear.dura <= 0) { this[slot] = null; broke = true; this.refreshGear(); }
    }
    dmg = Math.round(dmg);
    const dealt = Math.min(dmg, this.hp);
    if (attacker) attacker.dmgDealt += dealt;
    this.applyDamage(dmg, attacker, part);
    return { dmg, dealt, broke, killed: !this.alive };
  }

  applyDamage(dmg, attacker, kind) {
    if (!this.alive) return;
    this.hp -= dmg;
    if (kind !== 'zone') {
      this.using = null;
      this.resetCodes();           // 每次受到伤害重置自己的数字
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.state = 'dead';
      G.hooks.onDeath && G.hooks.onDeath(this, attacker, kind);
    }
  }

  // 使用消耗品（返回 null 表示开始使用，字符串表示原因）
  startUse(key) {
    if (!this.alive) return '';
    if (this.using) return '正在使用 ' + ITEM_DEFS[this.using.key].name;
    if (this.inv[key] <= 0) return '没有' + ITEM_DEFS[key].name;
    const d = ITEM_DEFS[key];
    if (d.cat === 'heal' && this.hp >= d.cap) return d.cap === 100 ? '生命值已满' : '生命值高于 75，需要医疗箱';
    if (d.cat === 'boost' && this.boost >= 100) return '能量已满';
    if (d.cat === 'camo' && this.camoT > 0) return '涂层仍在生效';
    this.using = { key, t: 0, dur: d.use };
    return null;
  }

  finishUse() {
    const key = this.using.key, d = ITEM_DEFS[key];
    this.using = null;
    if (this.inv[key] <= 0) return;
    this.inv[key]--;
    if (d.cat === 'heal') this.hp = Math.max(this.hp, Math.min(d.cap, this.hp + d.heal));
    else if (d.cat === 'boost') this.boost = Math.min(100, this.boost + d.boost);
    else if (d.cat === 'camo') { this.camoT = 15; drawCodes(this.char, this.bodyCode, this.headCode, true); }
    G.hooks.onUsed && G.hooks.onUsed(this, key);
  }

  speedMul() {
    let m = 1;
    if (this.using) m *= 0.45;
    if (this.boost > 60) m *= 1.07;
    return m;
  }

  updateStatus(dt) {
    if (!this.alive) return;
    if (this.using) {
      this.using.t += dt;
      if (this.using.t >= this.using.dur) this.finishUse();
    }
    if (this.boost > 0) {
      this.boost = Math.max(0, this.boost - 0.85 * dt);
      if (this.hp < HP_MAX) this.hp = Math.min(HP_MAX, this.hp + (this.boost > 60 ? 1.3 : 0.6) * dt);
    }
    if (this.camoT > 0) {
      this.camoT -= dt;
      this.camoRedraw -= dt;
      if (this.camoT <= 0) drawCodes(this.char, this.bodyCode, this.headCode, false);
      else if (this.camoRedraw <= 0) { this.camoRedraw = 0.25; drawCodes(this.char, this.bodyCode, this.headCode, true); }
    }
    if (this.blindT > 0) this.blindT -= dt;
    if (this.lockT > 0) this.lockT -= dt;
    if (this.throwCd > 0) this.throwCd -= dt;
    if (this.missStreak > 0) { this.missDecay -= dt; if (this.missDecay <= 0) this.missStreak = 0; }
    for (const [k, v] of this.reveal) { if (v - dt <= 0) this.reveal.delete(k); else this.reveal.set(k, v - dt); }
  }

  dropAll(spawnGround) {
    const items = [];
    if (this.helmet) items.push(['helmet' + this.helmet.lvl, 1, this.helmet.dura]);
    if (this.armor) items.push(['armor' + this.armor.lvl, 1, this.armor.dura]);
    if (this.bag) items.push(['bag' + this.bag, 1]);
    for (const s of this.scopes) items.push(['scope' + s, 1]);
    if (this.scanner) items.push(['scanner', 1]);
    for (const k of CONSUMABLES) if (this.inv[k] > 0) items.push([k, this.inv[k]]);
    items.forEach(([k, n, dura], i) => {
      const a = (i / Math.max(1, items.length)) * Math.PI * 2;
      const r = 0.6 + (i % 3) * 0.45;
      spawnGround(k, this.pos.x + Math.cos(a) * r, this.pos.z + Math.sin(a) * r, n, dura ?? null, this.pos.y);
    });
  }
}

export function gearDuraMax(lvl) { return ARMOR_DURA[lvl]; }
