// 瞳击 EYE ROYALE — 主程序
import * as THREE from 'three';
import { G } from './state.js';
import { buildWorld, W, segBlocked } from './world.js';
import { Actor } from './actor.js';
import { initBot, updateBot } from './bot.js';
import { initInput, updatePlayer, input, requestLock, useItem, throwKind } from './player.js';
import { I, spawnLoot, clearAll, spawnGround, updateItems, spawnAirdrop } from './items.js';
import { Z, initZoneMesh, resetZone, updateZone, outsideZone } from './zone.js';
import { P, initPlaneMesh, startPlane, updatePlane } from './plane.js';
import { updateScanners, platePos } from './combat.js';
import { animateCharacter } from './character.js';
import * as HUD from './hud.js';
import { sfx, initAudio, setAmbience, setMuted, muted } from './audio.js';
import { BOT_NAMES, DIFFICULTY, ITEM_DEFS } from './config.js';
import { shuffle, fmtTime } from './util.js';

const $ = id => document.getElementById(id);
const tmp = new THREE.Vector3();

// ---------- 渲染器与场景 ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight);
G.renderer = renderer;
G.maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
G.scene = scene;
const HORIZON = new THREE.Color(0xc6d9e8);
scene.fog = new THREE.Fog(HORIZON, 170, 980);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 2600);
G.camera = camera;

scene.add(new THREE.HemisphereLight(0xd8ecff, 0x5d6b3c, 1.55));
const sunDir = new THREE.Vector3(0.45, 0.8, 0.25).normalize();
const sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
sun.position.copy(sunDir).multiplyScalar(100);
scene.add(sun);

const sky = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x3d7fd0) }, mid: { value: HORIZON }, sunDir: { value: sunDir } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 sunDir; varying vec3 vP;
    void main(){ float h = vP.y; vec3 c = mix(mid, top, smoothstep(0.0, 0.55, h));
      float s = max(dot(normalize(vP), sunDir), 0.0);
      c += vec3(1.0, 0.92, 0.75) * pow(s, 600.0) * 2.0 + vec3(1.0, 0.85, 0.6) * pow(s, 10.0) * 0.18;
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -1;
scene.add(sky);

// 闪光特效
const fxList = [];
let flashTex = null;
function flashFx(pos) {
  if (!flashTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,240,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    flashTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, fog: false }));
  s.position.copy(pos);
  s.scale.setScalar(12);
  scene.add(s);
  fxList.push({ s, t: 0, life: 0.35 });
}

// ---------- 设置 ----------
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('eye-royale-settings') || '{}');
    Object.assign(G.settings, s);
  } catch (e) { /* ignore */ }
  $('nick').value = G.settings.name;
  $('botsSel').value = String(G.settings.bots);
  $('sens').value = G.settings.sens; $('sensPause').value = G.settings.sens;
  $('sensVal').textContent = Number(G.settings.sens).toFixed(1);
  document.querySelectorAll('#diffSel button').forEach(b => b.classList.toggle('on', Number(b.dataset.d) === G.settings.diff));
}
function saveSettings() {
  try { localStorage.setItem('eye-royale-settings', JSON.stringify(G.settings)); } catch (e) { /* ignore */ }
}

// ---------- 对局 ----------
function resetMatch() {
  for (const a of G.actors) {
    scene.remove(a.char.root);
    a.char.bodyTex.dispose(); a.char.headTex.dispose();
  }
  G.actors = [];
  G.player = null;
  clearAll();
  P.active = false; P.mesh.visible = false;
  for (const f of fxList) scene.remove(f.s);
  fxList.length = 0;
}

function startMatch() {
  initAudio();
  resetMatch();
  G.settings.name = ($('nick').value || '玩家').slice(0, 12);
  G.settings.bots = Number($('botsSel').value) || 29;
  saveSettings();
  const names = shuffle(BOT_NAMES.slice());
  const p = new Actor(G.settings.name, true, 0x3a7bd5);
  G.player = p;
  G.actors.push(p);
  for (let i = 0; i < G.settings.bots; i++) {
    const nm = names[i % names.length] + (i >= names.length ? String(i) : '');
    G.actors.push(new Actor(nm, false, new THREE.Color().setHSL(Math.random(), 0.55, 0.42)));
  }
  startPlane();
  for (const a of G.actors) if (!a.isPlayer) initBot(a);
  spawnLoot();
  resetZone();
  G.totalPlayers = G.actors.length;
  G.matchTime = 0;
  G.mode = 'match';
  G.paused = false;
  G.codeBuf = ''; G.lastCode = '';
  G.stats = { head: 0, body: 0, miss: 0, dmg: 0 };
  G.dropTimes = [175 + Math.random() * 40, 360 + Math.random() * 40];
  input.scopeSel = 0; input.ads = false;
  p.yaw = Math.atan2(P.dir.x, P.dir.z) + Math.PI * 0.5;
  p.pitch = -0.25;
  $('menu').classList.add('hidden');
  $('end').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('hud').classList.remove('hidden');
  HUD.resetHUD();
  setAmbience('plane');
  requestLock();
  HUD.banner('运输机已起飞<small>飞到岛屿上空后按 F 跳伞 · 按 M 看地图选落点</small>');
}

function aliveCount() { let n = 0; for (const a of G.actors) if (a.alive) n++; return n; }

function endMatch(win) {
  if (G.mode !== 'match') return;
  G.mode = 'over';
  if (document.exitPointerLock) document.exitPointerLock();
  const p = G.player;
  const place = win ? 1 : p.place;
  $('endTitle').innerHTML = win ? '大吉大利 · 今晚吃鸡' : `第 <b>${place}</b> 名`;
  $('endSub').textContent = win ? `你是 ${G.totalPlayers} 人中最后的“瞳击手”` : (p.killedBy ? `被 ${p.killedBy} 淘汰` : '倒在了安全区外') + ' · 再接再厉';
  const total = G.stats.head + G.stats.body;
  const acc = total + G.stats.miss ? Math.round(total / (total + G.stats.miss) * 100) : 0;
  $('endStats').innerHTML = [
    ['排名', `#${place}/${G.totalPlayers}`], ['击杀', p.kills], ['造成伤害', Math.round(G.stats.dmg)],
    ['头部识别', G.stats.head], ['身体识别', G.stats.body], ['读码准确率', acc + '%'], ['存活时间', fmtTime(win ? G.matchTime : p.deathTime)],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  $('end').classList.toggle('win', !!win);
  setTimeout(() => $('end').classList.remove('hidden'), win ? 600 : 0);
  HUD.toggleMap(false); HUD.toggleInv(false);
  setAmbience('ground');
  if (win) sfx.win(); else sfx.lose();
}

// ---------- 事件钩子 ----------
G.hooks.toast = HUD.toast;
G.hooks.onDeath = (v, att, kind) => {
  v.deathTime = G.matchTime;
  v.place = aliveCount() + 1;
  v.using = null;
  v.dropAll(spawnGround);
  if (att) { att.kills++; v.killedBy = att.name; }
  const how = kind === 'head' ? '<span class="how head">头部识别</span>' : kind === 'body' ? '<span class="how body">身体识别</span>' : '<span class="how zone">倒在安全区外</span>';
  const mine = att === G.player || v === G.player;
  HUD.killfeed(att ? `<b>${att.name}</b>${how}<b>${v.name}</b>` : `<b>${v.name}</b>${how}`, mine);
  if (att === G.player) {
    sfx.kill();
    HUD.banner(`淘汰 <b>${v.name}</b><small>${kind === 'head' ? '头部识别' : '身体识别'} · 本局第 ${att.kills} 杀 · 剩余 ${aliveCount()} 人</small>`, 'kill');
  }
  if (v === G.player) {
    setTimeout(() => endMatch(false), 1600);
    HUD.banner(`你被淘汰了<small>${att ? att.name + ' 读出了你的' + (kind === 'head' ? '头部' : '身体') + '编号' : '安全区外伤害'}</small>`, 'dead');
  }
};
G.hooks.onHit = (att, tgt, part, res) => {
  const p = G.player;
  if (att === p) {
    HUD.hitmarker(part, res.killed);
    HUD.codeResult(true, part);
    if (part === 'head') sfx.hitHead(); else sfx.hitBody();
    if (res.broke) sfx.armorBreak();
    platePos(tgt, part, tmp);
    HUD.floatText(tmp, (part === 'head' ? '爆头 ' : '') + '-' + res.dmg + (res.broke ? ' 破甲' : ''), part);
    G.stats.dmg += res.dealt;
  }
  if (tgt === p) {
    HUD.hurtFlash(res.dmg);
    sfx.hurt();
    if (res.broke) sfx.armorBreak();
    if (p.alive) HUD.toast(`被 ${att.name} 读出${part === 'head' ? '头部' : '身体'}编号 -${res.dmg}${res.broke ? '（防具损坏）' : ''} · 你的编号已重置`, 'bad');
  }
};
G.hooks.onMiss = (p, why) => {
  HUD.codeResult(false);
  sfx.miss();
  HUD.toast(`${why} · 输入锁定 ${p.lockT.toFixed(1)} 秒`, 'bad');
};
G.hooks.onLockedType = () => { sfx.deny(); };
G.hooks.onReveal = (v, t) => {
  if (v === G.player) { sfx.scanDone(); HUD.toast(`扫描完成：${t.name} 的编号已显示`, 'ok'); }
  if (t === G.player) { sfx.warn(); HUD.toast('你被扫描器读出了编号！快离开或转身', 'bad'); }
};
G.hooks.onBlind = inten => { HUD.flashBlind(inten); sfx.tinnitus(1 + inten * 3); };
G.hooks.onFlashFx = pos => { flashFx(pos); sfx.flash(pos.distanceTo(camera.position)); };
G.hooks.onSmoke = pos => { if (pos.distanceTo(camera.position) < 80) sfx.smoke(); };
G.hooks.onThrow = (a, kind) => { if (a === G.player) { sfx.throw(); HUD.toast('投出 ' + ITEM_DEFS[kind].name, 'ok'); } };
G.hooks.onUsed = (a, key) => { if (a === G.player) { sfx.used(); HUD.toast(ITEM_DEFS[key].name + ' 使用完毕', 'ok'); } };
G.hooks.onZone = (state) => {
  if (state === 'shrink') { HUD.banner('安全区开始收缩！<small>注意蓝圈位置</small>', 'zone'); sfx.zone(); }
  else HUD.banner(`新的安全区已刷新<small>${fmtTime(Z.timer)} 后开始收缩 · 白圈为下一个安全区</small>`, 'zone');
};
G.hooks.onAirdropLand = () => {};
G.hooks.onJump = () => HUD.toast('自由落体中 · 按 F 开伞，W 俯冲加速', 'ok');
G.hooks.onLand = () => HUD.banner('着陆！<small>搜集物资 · 看清敌人身上的数字并抢先输入</small>');
G.hooks.onScopeChange = z => HUD.toast(z ? `切换到 ${z} 倍镜` : '切换到 眯眼（1.3×）', 'ok');
G.hooks.toggleInv = () => HUD.toggleInv();
G.hooks.toggleMap = () => HUD.toggleMap();
G.hooks.togglePause = () => setPaused(!G.paused);
G.hooks.onUnlock = () => { if (G.mode === 'match' && !G.paused) setPaused(true); };
G.hooks.onDragMode = () => { $('dragHint').classList.remove('hidden'); HUD.toast('此页面无法锁定鼠标：按住左键拖动来转视角', 'warn'); };

function setPaused(v) {
  if (G.mode !== 'match') return;
  G.paused = v;
  $('pause').classList.toggle('hidden', !v);
  if (!v) requestLock();
}

// ---------- 主循环 ----------
function update(dt) {
  G.matchTime += dt;
  updatePlane(dt);
  if (G.player) updatePlayer(dt);
  for (const a of G.actors) if (!a.isPlayer) updateBot(a, dt);
  for (const a of G.actors) a.updateStatus(dt);
  updateScanners(dt);
  updateItems(dt);
  updateZone(dt);
  // 圈外伤害
  for (const a of G.actors) {
    if (!a.alive || (a.state !== 'ground' && a.state !== 'chute')) continue;
    if (Z.dps > 0 && outsideZone(a.pos.x, a.pos.z)) {
      a.zoneTick += dt;
      if (a.zoneTick >= 1) {
        a.zoneTick = 0;
        a.applyDamage(Z.dps, null, 'zone');
        if (a === G.player) HUD.hurtFlash(6);
      }
    } else a.zoneTick = 0;
  }
  // 空投
  if (G.dropTimes && G.dropTimes.length && G.matchTime > G.dropTimes[0]) {
    G.dropTimes.shift();
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Z.next.r * 0.8;
    spawnAirdrop(Z.next.x + Math.cos(a) * r, Z.next.z + Math.sin(a) * r);
    HUD.banner('空投正在降落！<small>小地图上的红色方块 · 内有三级装备与 8 倍镜</small>', 'drop');
    sfx.zone();
  }
  // 角色动画
  for (const a of G.actors) {
    if (a.isPlayer) continue;
    if (a.state === 'plane') { a.char.root.visible = false; continue; }
    if (!a.alive && G.matchTime - a.deathTime > 12) { a.char.root.visible = false; continue; }
    a.char.root.visible = true;
    animateCharacter(a.char, a, dt);
  }
  // 附近敌人的脚步声（带左右声道）
  footsteps(dt);
  // 特效
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i];
    f.t += dt;
    f.s.material.opacity = 1 - f.t / f.life;
    f.s.scale.setScalar(12 + f.t * 40);
    if (f.t >= f.life) { scene.remove(f.s); fxList.splice(i, 1); }
  }
  HUD.updateHUD(dt);
  if (G.mode === 'match' && G.player.alive && aliveCount() === 1) endMatch(true);
}

let stepT = 0;
function footsteps(dt) {
  const p = G.player;
  stepT -= dt;
  if (stepT > 0 || !p || !p.alive || p.state !== 'ground') return;
  let best = null, bd = 24, bsp = 0;
  for (const a of G.actors) {
    if (a === p || !a.alive || a.state !== 'ground') continue;
    const sp = Math.hypot(a.vel.x, a.vel.z);
    if (sp < 1.6 || a.crouch) continue;
    const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
    if (d < bd) { bd = d; best = a; bsp = sp; }
  }
  if (!best) { stepT = 0.2; return; }
  const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const side = (dx * -fz + dz * fx) / (bd || 1);
  sfx.step(Math.max(-1, Math.min(1, side)), 0.04 + 0.32 * (1 - bd / 24));
  stepT = bsp > 5 ? 0.32 : 0.47;
}

let menuAngle = 0;
function menuCam(dt) {
  menuAngle += dt * 0.04;
  camera.position.set(Math.cos(menuAngle) * 430, 190, Math.sin(menuAngle) * 430);
  camera.lookAt(0, 0, 0);
  if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  G.time += dt;
  if ((G.mode === 'match' && !G.paused) || G.mode === 'over') update(dt);
  else if (G.mode === 'menu') menuCam(dt);
  sky.position.copy(camera.position);
  if (!window.__eyeNoRender) renderer.render(scene, camera);
}

// ---------- 界面绑定 ----------
function bindUI() {
  $('startBtn').addEventListener('click', startMatch);
  $('againBtn').addEventListener('click', startMatch);
  $('menuBtn').addEventListener('click', toMenu);
  $('quitBtn').addEventListener('click', toMenu);
  $('resumeBtn').addEventListener('click', () => setPaused(false));
  document.querySelectorAll('#diffSel button').forEach(b => b.addEventListener('click', () => {
    G.settings.diff = Number(b.dataset.d);
    document.querySelectorAll('#diffSel button').forEach(x => x.classList.toggle('on', x === b));
    saveSettings();
  }));
  const onSens = e => {
    G.settings.sens = Number(e.target.value);
    $('sensVal').textContent = G.settings.sens.toFixed(1);
    $('sens').value = G.settings.sens; $('sensPause').value = G.settings.sens;
    saveSettings();
  };
  $('sens').addEventListener('input', onSens);
  $('sensPause').addEventListener('input', onSens);
  $('muteBtn').addEventListener('click', () => { setMuted(!muted); $('muteBtn').textContent = muted ? '声音：关' : '声音：开'; });
  // 物品栏点击
  $('items').addEventListener('click', e => {
    const it = e.target.closest('.it');
    if (!it) return;
    const k = it.querySelector('kbd').textContent;
    const map = { Z: 'bandage', X: 'firstaid', V: 'medkit', B: 'drink', T: 'camo' };
    if (map[k]) useItem(map[k]); else if (k === 'Q') throwKind('flash'); else if (k === 'E') throwKind('smoke');
  });
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('touchWarn').classList.remove('hidden');
}

function toMenu() {
  if (document.exitPointerLock) document.exitPointerLock();
  resetMatch();
  G.mode = 'menu';
  G.paused = false;
  Z.mesh.visible = false;
  $('hud').classList.add('hidden');
  $('end').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('menu').classList.remove('hidden');
  setAmbience('ground');
}

function boot() {
  initZoneMesh(scene);
  initPlaneMesh(scene);
  HUD.initHUD();
  initInput(canvas);
  bindUI();
  loadSettings();
  setTimeout(() => {
    const t0 = performance.now();
    buildWorld(scene);
    console.log('world built in', Math.round(performance.now() - t0), 'ms;', W.buildings.length, 'buildings,', W.towns.length, 'towns');
    $('loading').classList.add('hidden');
    $('startBtn').disabled = false;
    requestAnimationFrame(frame);
  }, 30);
}

window.__eye = { G, W, Z, P, I, input, segBlocked, startMatch, update, toMenu };
boot();
