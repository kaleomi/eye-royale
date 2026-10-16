// HUD：数字输入、血量装备、小地图、击杀信息、各种提示
import * as THREE from 'three';
import { G } from './state.js';
import { W } from './world.js';
import { Z } from './zone.js';
import { P } from './plane.js';
import { I, nearestItem, itemLabel } from './items.js';
import { input, zoomFactor, playerAGL, scopeList } from './player.js';
import { ITEM_DEFS, MAP_HALF, ARMOR_DURA, CONSUMABLES, SCAN_TIME, WEAPONS } from './config.js';
import { trainingSummary } from './training.js';
import { fmtTime } from './util.js';

const $ = id => document.getElementById(id);
let el = {};
let mmTimer = 0, slowTimer = 0, lastWeaponKey = '';
const v3 = new THREE.Vector3(), fwd = new THREE.Vector3();
const revealLabels = new Map();
const eyeEls = new Map();

export function initHUD() {
  el = {
    hud: $('hud'), alive: $('alive'), kills: $('kills'), zoneinfo: $('zoneinfo'),
    minimap: $('minimap'), killfeed: $('killfeed'), hit: $('hitmarker'), floaters: $('floaters'),
    eyes: $('eyes'), prompt: $('prompt'), toast: $('toast'), banner: $('banner'),
    usebar: $('usebar'), scanbox: $('scanbox'), alt: $('alt'),
    codeArea: $('codeArea'), slots: [...document.querySelectorAll('#codeSlots span')], codeHint: $('codeHint'), lockbar: $('lockbar'),
    hpFill: $('hpFill'), hpText: $('hpText'), boostFill: $('boostFill'), gear: $('gear'), mycode: $('mycode'),
    items: $('items'), cap: $('cap'), scope: $('scopeOverlay'), scopeLbl: $('scopeLbl'),
    blind: $('blind'), zoneTint: $('zoneTint'), vignette: $('vignette'),
    bigmap: $('bigmap'), bigCanvas: $('bigCanvas'), inv: $('invpanel'), crosshair: $('crosshair'), zoomTag: $('zoomTag'),
    train: $('trainPanel'),
  };
  lastWeaponKey = '';
  el.mm = el.minimap.getContext('2d');
}

export function resetHUD() {
  lastWeaponKey = '';
  el.killfeed.innerHTML = '';
  el.floaters.innerHTML = '';
  el.eyes.innerHTML = '';
  revealLabels.clear();
  eyeEls.clear();
  el.blind.style.opacity = 0;
  el.vignette.style.opacity = 0;
  el.bigmap.classList.add('hidden');
  el.inv.classList.add('hidden');
}

let toastT = null;
export function toast(msg, kind = '') {
  el.toast.textContent = msg;
  el.toast.className = 'show ' + kind;
  clearTimeout(toastT);
  toastT = setTimeout(() => (el.toast.className = ''), 1800);
}

let bannerT = null;
export function banner(msg, kind = '') {
  el.banner.innerHTML = msg;
  el.banner.className = 'show ' + kind;
  clearTimeout(bannerT);
  bannerT = setTimeout(() => (el.banner.className = ''), 3200);
}

export function killfeed(html, mine) {
  const d = document.createElement('div');
  d.className = 'kf' + (mine ? ' mine' : '');
  d.innerHTML = html;
  el.killfeed.prepend(d);
  while (el.killfeed.children.length > 6) el.killfeed.lastChild.remove();
  setTimeout(() => d.classList.add('fade'), 6000);
  setTimeout(() => d.remove(), 7000);
}

export function hitmarker(part, killed) {
  el.hit.className = '';
  void el.hit.offsetWidth;
  el.hit.className = 'show ' + (killed ? 'kill' : part);
}

export function codeResult(ok, part) {
  el.codeArea.classList.remove('ok', 'bad', 'head');
  void el.codeArea.offsetWidth;
  el.codeArea.classList.add(ok ? 'ok' : 'bad');
  if (ok && part === 'head') el.codeArea.classList.add('head');
}

export function floatText(worldPos, text, cls) {
  v3.copy(worldPos).project(G.camera);
  if (v3.z > 1) return;
  const d = document.createElement('div');
  d.className = 'float ' + cls;
  d.textContent = text;
  d.style.left = ((v3.x * 0.5 + 0.5) * innerWidth) + 'px';
  d.style.top = ((-v3.y * 0.5 + 0.5) * innerHeight) + 'px';
  el.floaters.appendChild(d);
  setTimeout(() => d.remove(), 1100);
}

export function flashBlind(inten) {
  el.blind.style.transition = 'none';
  el.blind.style.opacity = Math.min(1, 0.55 + inten * 0.45);
}

export function hurtFlash(amount) {
  el.vignette.style.transition = 'none';
  el.vignette.style.opacity = Math.min(1, 0.35 + amount / 80);
  requestAnimationFrame(() => {
    el.vignette.style.transition = 'opacity 0.9s';
    el.vignette.style.opacity = 0;
  });
}

export function toggleMap(force) {
  const show = force != null ? force : el.bigmap.classList.contains('hidden');
  el.bigmap.classList.toggle('hidden', !show);
  if (show) drawBigMap();
}
export function toggleInv(force) {
  const show = force != null ? force : el.inv.classList.contains('hidden');
  el.inv.classList.toggle('hidden', !show);
  if (show) renderInv();
}

function gearChip(label, lvl, dura, max) {
  const pct = max ? Math.max(0, dura / max) : 1;
  return `<div class="chip l${lvl}"><span>${label}</span>${max ? `<i style="width:${pct * 100}%"></i>` : ''}</div>`;
}

function renderInv() {
  const p = G.player;
  const rows = [];
  rows.push('<h3>装备</h3><div class="invgrid">');
  rows.push(`<div>头盔</div><div>${p.helmet ? ITEM_DEFS['helmet' + p.helmet.lvl].name + ` · 耐久 ${Math.round(p.helmet.dura / p.helmet.max * 100)}%` : '—'}</div>`);
  rows.push(`<div>护甲</div><div>${p.armor ? ITEM_DEFS['armor' + p.armor.lvl].name + ` · 耐久 ${Math.round(p.armor.dura / p.armor.max * 100)}%` : '—'}</div>`);
  rows.push(`<div>背包</div><div>${p.bag ? ITEM_DEFS['bag' + p.bag].name : '无'} · 容量 ${p.invWeight()}/${p.capacity()}</div>`);
  rows.push(`<div>倍镜</div><div>${p.scopes.size ? [...p.scopes].sort().map(s => s + '倍').join(' / ') : '—'}</div>`);
  rows.push(`<div>扫描器</div><div>${p.scanner ? '已装备' : '—'}</div></div>`);
  rows.push('<h3>物品</h3><div class="invgrid">');
  for (const k of CONSUMABLES) {
    const d = ITEM_DEFS[k];
    rows.push(`<div><kbd>${d.key}</kbd> ${d.name}</div><div>${p.inv[k]} <small>（每个占 ${d.weight}）</small></div>`);
  }
  rows.push('</div><p class="dim">按 Tab 关闭</p>');
  el.inv.innerHTML = rows.join('');
}

export function updateHUD(dt) {
  const p = G.player;
  if (!p) return;
  slowTimer -= dt;
  mmTimer -= dt;
  // 读码武器提示
  const W = WEAPONS[p.weapon] || WEAPONS.std;
  const wkey = p.weapon + '|' + p.weaponList().join(',');
  if (wkey !== lastWeaponKey) {
    lastWeaponKey = wkey;
    const owned = p.weaponList();
    if (owned.length <= 1) el.codeHint.innerHTML = '看清敌人胸口 / 额头的数字，直接用键盘输入';
    else el.codeHint.innerHTML = `<kbd>R</kbd> <b class="w-${p.weapon}">${W.name}</b> ${W.hint} · 伤害 ×${W.mult}` +
      `<span class="owned">${owned.map(w => `<i class="${w === p.weapon ? 'on w-' + w : ''}">${WEAPONS[w].short}</i>`).join('')}</span>`;
    el.slots[3].style.display = W.len === 4 ? '' : 'none';
    el.codeArea.dataset.w = p.weapon;
  }
  // 数字输入
  const buf = G.codeBuf;
  const showLast = G.lastCode && G.time - (G.lastCodeT || 0) < 0.45;
  for (let i = 0; i < 4; i++) {
    const s = el.slots[i];
    const ch = showLast ? G.lastCode[i] : (buf[i] || '');
    if (s.textContent !== ch) s.textContent = ch;
    s.classList.toggle('filled', !!ch);
  }
  const locked = p.lockT > 0;
  el.codeArea.classList.toggle('locked', locked);
  el.lockbar.firstElementChild.style.width = locked ? Math.min(100, p.lockT / 1.6 * 100) + '%' : '0%';

  // 盲、圈外、开镜
  const blindA = p.blindT > 0 ? Math.min(1, p.blindT / Math.min(2, p.blindMax)) : 0;
  el.blind.style.opacity = blindA;
  const outside = p.alive && Math.hypot(p.pos.x - Z.cur.x, p.pos.z - Z.cur.z) > Z.cur.r && Z.phase >= 0;
  el.zoneTint.style.opacity = outside ? 1 : 0;
  const zf = zoomFactor();
  const scoped = zf >= 2 && p.alive;
  el.scope.classList.toggle('on', scoped);
  el.hud.classList.toggle('scoped', scoped);
  el.crosshair.style.display = scoped ? 'none' : '';
  if (scoped) el.scopeLbl.textContent = zf + '×';
  el.zoomTag.textContent = input.ads && p.alive ? (zf >= 2 ? zf + '倍镜' : '眯眼') : (p.scopes.size ? '右键开镜 · ' + (input.scopeSel ? input.scopeSel + '×' : '眯眼') : '');

  // 使用物品
  if (p.using) {
    el.usebar.classList.add('show');
    el.usebar.querySelector('.lbl').textContent = '使用 ' + ITEM_DEFS[p.using.key].name;
    el.usebar.querySelector('i').style.width = (p.using.t / p.using.dur * 100) + '%';
  } else el.usebar.classList.remove('show');

  // 拾取 / 跳伞提示
  let prompt = '';
  if (p.alive) {
    if (p.state === 'plane') prompt = P.active && Math.abs(P.pos.x) < MAP_HALF - 40 && Math.abs(P.pos.z) < MAP_HALF - 40 ? '<kbd>F</kbd> 跳伞' : '飞往岛屿上空…';
    else if (p.state === 'fall') prompt = '<kbd>F</kbd> 开伞 · <kbd>W</kbd> 加速俯冲';
    else if (p.state === 'ground') {
      p.forward(fwd);
      const it = nearestItem(p, 2.6, fwd);
      if (it) prompt = `<kbd>F</kbd> 拾取 ${itemLabel(it)}`;
    }
  }
  if (el.prompt.innerHTML !== prompt) el.prompt.innerHTML = prompt;
  el.prompt.style.display = prompt ? '' : 'none';
  if (p.state === 'fall' || p.state === 'chute') { el.alt.style.display = ''; el.alt.textContent = '高度 ' + Math.max(0, Math.round(playerAGL())) + ' m'; }
  else el.alt.style.display = 'none';

  // 扫描进度
  let bestScan = 0, scanName = '';
  for (const [id, prog] of p.scanProg) if (prog > bestScan) { bestScan = prog; const t = G.actors.find(a => a.id === id); scanName = t ? t.name : ''; }
  let alert = 0;
  if (p.alive) for (const a of G.actors) {
    if (a === p || !a.alive || !a.scanner) continue;
    const pr = a.scanProg.get(p.id);
    if (pr && pr > alert) alert = pr;
  }
  if (bestScan > 0.05) {
    el.scanbox.className = 'show';
    el.scanbox.innerHTML = `<b>扫描中</b> ${scanName}<div class="track"><i style="width:${bestScan / SCAN_TIME * 100}%"></i></div>`;
  } else if (alert > 0.5) {
    el.scanbox.className = 'show alert';
    el.scanbox.innerHTML = `<b>警告</b> 有人在你背后扫描<div class="track"><i style="width:${alert / SCAN_TIME * 100}%;background:var(--red)"></i></div>`;
  } else el.scanbox.className = '';

  updateEyes(p);
  updateRevealLabels(p);

  if (slowTimer <= 0) {
    slowTimer = 0.12;
    const alive = G.actors.filter(a => a.alive).length;
    el.alive.textContent = alive;
    el.kills.textContent = p.kills;
    if (G.training) {
      el.zoneinfo.innerHTML = '训练场 · 木人被读倒 1.5 秒后复活 · <kbd>Esc</kbd> 暂停可返回菜单';
      const st = trainingSummary();
      const tot = st.hits + G.stats.miss;
      el.train.innerHTML = `<h4>读码训练</h4>
        <div class="tg"><span>命中</span><b>${st.hits}</b><span>头 / 身</span><b>${st.head} / ${st.body}</b>
        <span>读错</span><b>${G.stats.miss}</b><span>准确率</span><b>${tot ? Math.round(st.hits / tot * 100) + '%' : '—'}</b>
        <span>平均用时</span><b>${st.avg != null ? st.avg.toFixed(2) + 's' : '—'}</b><span>最快</span><b>${st.best != null ? st.best.toFixed(2) + 's' : '—'}</b></div>
        <p>用时 = 数字出现在视野里到你读中为止</p>
        <ul><li>10 / 18 / 24 / 32 / 45 / 60 / 100 / 150 米各一个木人</li>
        <li>18 米：躲在矮墙后，只能读头</li><li>24 米：背对你，带着扫描器走近</li>
        <li>45 米：干扰涂层 · 60 米：三级头甲，试试破甲码</li></ul>`;
    }
    // 圈信息
    let zt = '';
    if (Z.state === 'wait') zt = Z.phase < 0 ? `首个安全区 <b>${fmtTime(Z.timer)}</b> 后开始收缩` : `安全区 <b>${fmtTime(Z.timer)}</b> 后收缩`;
    else if (Z.state === 'shrink') zt = `<span class="warn">安全区收缩中</span> <b>${fmtTime(Z.timer)}</b>`;
    else zt = '最终安全区';
    if (outside) zt += ` · <span class="danger">你在安全区外！-${Z.dps}/秒</span>`;
    if (!G.training) el.zoneinfo.innerHTML = zt;
    // 血量
    el.hpFill.style.width = Math.max(0, p.hp) + '%';
    el.hpFill.className = p.hp < 30 ? 'low' : p.hp < 75 ? 'mid' : '';
    el.hpText.textContent = Math.ceil(p.hp);
    el.boostFill.style.width = p.boost + '%';
    // 装备
    const scopes = [2, 4, 8].map(s => `<span class="sc ${p.scopes.has(s) ? 'has' : ''} ${input.scopeSel === s ? 'sel' : ''}">${s}×</span>`).join('');
    el.gear.innerHTML =
      gearChip(p.helmet ? '头' + p.helmet.lvl : '头 —', p.helmet ? p.helmet.lvl : 0, p.helmet && p.helmet.dura, p.helmet && p.helmet.max) +
      gearChip(p.armor ? '甲' + p.armor.lvl : '甲 —', p.armor ? p.armor.lvl : 0, p.armor && p.armor.dura, p.armor && p.armor.max) +
      gearChip(p.bag ? '包' + p.bag : '包 —', p.bag, 0, 0) +
      `<div class="chip scopes">${scopes}</div>` +
      (p.scanner ? '<div class="chip l3 scan"><span>扫描器</span></div>' : '');
    el.mycode.innerHTML = `我的编号 <b>${p.bodyCode}</b> 身 · <b>${p.headCode}</b> 头${p.camoT > 0 ? ` · <span class="camo">涂层 ${Math.ceil(p.camoT)}s</span>` : ''}`;
    // 物品栏
    el.items.innerHTML = CONSUMABLES.map(k => {
      const d = ITEM_DEFS[k];
      return `<div class="it ${p.inv[k] ? '' : 'none'}"><kbd>${d.key}</kbd><span>${d.name}</span><b>${p.inv[k]}</b></div>`;
    }).join('');
    el.cap.textContent = `背包 ${p.invWeight()}/${p.capacity()}`;
    if (!el.inv.classList.contains('hidden')) renderInv();
    if (!el.bigmap.classList.contains('hidden')) drawBigMap();
  }
  if (mmTimer <= 0) { mmTimer = 1 / 15; drawMinimap(); }
}

// “被注视”指示：有敌人正在读你的数字
function updateEyes(p) {
  const seen = new Set();
  if (p.alive) {
    for (const b of G.actors) {
      if (b === p || !b.alive || !b.ai) continue;
      const ai = b.ai;
      if (ai.readTarget !== p || !(ai.canBody || ai.canHead)) continue;
      seen.add(b.id);
      let e = eyeEls.get(b.id);
      if (!e) {
        e = document.createElement('div');
        e.className = 'eye';
        e.innerHTML = '<svg viewBox="0 0 48 28"><path d="M2 14 Q24 -6 46 14 Q24 34 2 14Z" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="14" r="6" fill="currentColor"/></svg>';
        el.eyes.appendChild(e);
        eyeEls.set(b.id, e);
      }
      const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const sx = dx * -fz + dz * fx, sy = dx * fx + dz * fz;
      const l = Math.hypot(sx, sy) || 1;
      const prog = Math.min(1, ai.readT / ai.readNeed);
      const R = Math.min(innerWidth, innerHeight) * 0.3;
      const x = sx / l * R, y = -sy / l * R;
      e.style.transform = `translate(${x}px, ${y}px) scale(${0.8 + prog * 0.5})`;
      e.style.opacity = 0.35 + prog * 0.65;
      e.classList.toggle('hot', prog > 0.65);
    }
  }
  for (const [id, e] of eyeEls) if (!seen.has(id)) { e.remove(); eyeEls.delete(id); }
}

function updateRevealLabels(p) {
  const seen = new Set();
  for (const t of G.actors) {
    if (t === p || !t.alive) continue;
    const r = t.reveal.get(p.id);
    if (!r) continue;
    seen.add(t.id);
    let e = revealLabels.get(t.id);
    if (!e) {
      e = document.createElement('div');
      e.className = 'reveal';
      el.floaters.appendChild(e);
      revealLabels.set(t.id, e);
    }
    v3.set(t.pos.x, t.pos.y + 2.5, t.pos.z).project(G.camera);
    if (v3.z > 1) { e.style.display = 'none'; continue; }
    e.style.display = '';
    e.style.left = ((v3.x * 0.5 + 0.5) * innerWidth) + 'px';
    e.style.top = ((-v3.y * 0.5 + 0.5) * innerHeight) + 'px';
    e.innerHTML = `头 <b>${t.headCode}</b> · 身 <b>${t.bodyCode}</b><i style="width:${r / 8 * 100}%"></i>`;
  }
  for (const [id, e] of revealLabels) if (!seen.has(id)) { e.remove(); revealLabels.delete(id); }
}

function w2m(x, z, cx, cz, scale, S) {
  return [S / 2 + (x - cx) * scale, S / 2 + (z - cz) * scale];
}

function drawMinimap() {
  const p = G.player, ctx = el.mm, S = el.minimap.width;
  const air = p.state === 'plane' || p.state === 'fall';
  const span = air ? 1300 : 300; // 小地图显示范围（米）
  const scale = S / span;
  const cx = air ? 0 : p.pos.x, cz = air ? 0 : p.pos.z;
  ctx.fillStyle = '#1d3d55';
  ctx.fillRect(0, 0, S, S);
  const mk = W.mapCanvas.width / (MAP_HALF * 2);
  const sx = (cx - span / 2 + MAP_HALF) * mk, sy = (cz - span / 2 + MAP_HALF) * mk;
  ctx.drawImage(W.mapCanvas, sx, sy, span * mk, span * mk, 0, 0, S, S);
  drawZones(ctx, cx, cz, scale, S, 1.5);
  if (P.active || p.state === 'plane') {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
    ctx.beginPath();
    let [a, b] = w2m(P.start.x, P.start.z, cx, cz, scale, S); ctx.moveTo(a, b);
    [a, b] = w2m(P.end.x, P.end.z, cx, cz, scale, S); ctx.lineTo(a, b); ctx.stroke(); ctx.setLineDash([]);
  }
  drawDrops(ctx, cx, cz, scale, S);
  const [px, py] = w2m(p.pos.x, p.pos.z, cx, cz, scale, S);
  drawArrow(ctx, px, py, p.yaw, 7);
  // 指北
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('N', S / 2, 12);
}

function drawZones(ctx, cx, cz, scale, S, lw) {
  // 圈外蒙版
  const [zx, zy] = w2m(Z.cur.x, Z.cur.z, cx, cz, scale, S);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, S, S);
  ctx.arc(zx, zy, Math.max(0, Z.cur.r * scale), 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(40,80,220,0.28)';
  ctx.fill('evenodd');
  ctx.restore();
  ctx.lineWidth = lw * 1.4;
  ctx.strokeStyle = '#4d8dff';
  ctx.beginPath(); ctx.arc(zx, zy, Math.max(0, Z.cur.r * scale), 0, Math.PI * 2); ctx.stroke();
  if (Z.state !== 'done') {
    const [nx, ny] = w2m(Z.next.x, Z.next.z, cx, cz, scale, S);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(nx, ny, Math.max(0, Z.next.r * scale), 0, Math.PI * 2); ctx.stroke();
  }
}

function drawDrops(ctx, cx, cz, scale, S) {
  for (const d of I.drops) {
    const [x, y] = w2m(d.x, d.z, cx, cz, scale, S);
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x - 4, y - 4, 8, 8);
  }
}

function drawArrow(ctx, x, y, yaw, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-yaw);
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.3); ctx.lineTo(s * 0.8, s); ctx.lineTo(0, s * 0.45); ctx.lineTo(-s * 0.8, s); ctx.closePath();
  ctx.fillStyle = '#ffc928'; ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}

export function drawBigMap() {
  const c = el.bigCanvas, ctx = c.getContext('2d'), S = c.width;
  const scale = S / (MAP_HALF * 2);
  ctx.drawImage(W.mapCanvas, 0, 0, S, S);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  for (let i = 1; i < 12; i++) { const v = i * S / 12; ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, S); ctx.moveTo(0, v); ctx.lineTo(S, v); ctx.stroke(); }
  drawZones(ctx, 0, 0, scale, S, 2);
  if (P.active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 2;
    ctx.beginPath();
    let [a, b] = w2m(P.start.x, P.start.z, 0, 0, scale, S); ctx.moveTo(a, b);
    [a, b] = w2m(P.end.x, P.end.z, 0, 0, scale, S); ctx.lineTo(a, b); ctx.stroke(); ctx.setLineDash([]);
    const [px, py] = w2m(P.pos.x, P.pos.z, 0, 0, scale, S);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.font = 'bold 14px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  for (const t of W.towns) {
    const [x, y] = w2m(t.x, t.z, 0, 0, scale, S);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(t.name, x, y - t.r * scale - 4);
    ctx.fillStyle = '#fff'; ctx.fillText(t.name, x, y - t.r * scale - 4);
  }
  if (W.range) {
    const r = W.range;
    const [x, y] = w2m(r.x, r.z1, 0, 0, scale, S);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(r.name, x, y - 6);
    ctx.fillStyle = '#ffe6a1'; ctx.fillText(r.name, x, y - 6);
  }
  drawDrops(ctx, 0, 0, scale, S);
  const p = G.player;
  if (p) { const [px, py] = w2m(p.pos.x, p.pos.z, 0, 0, scale, S); drawArrow(ctx, px, py, p.yaw, 10); }
}
