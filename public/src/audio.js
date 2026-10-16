// 合成音效（无外部资源）
let ctx = null, master = null, noiseBuf = null;
let wind = null, drone = null;
export let muted = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }

function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.3, freq = 1000, q = 0.7, type = 'bandpass', delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t); s.stop(t + dur + 0.05);
}

function loop(freq, type, vol, filterFreq) {
  if (!ctx) return null;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq; f.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = 0;
  s.connect(f); f.connect(g); g.connect(master);
  s.start();
  let o = null;
  if (freq) {
    o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const og = ctx.createGain(); og.gain.value = 0.25;
    const of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 300;
    o.connect(of); of.connect(og); og.connect(g); o.start();
  }
  return { g, f, vol };
}

export const sfx = {
  key() { tone(1400 + Math.random() * 200, 0.04, 'square', 0.06); },
  clear() { tone(500, 0.05, 'square', 0.05); },
  hitBody() { tone(880, 0.12, 'triangle', 0.25); tone(1320, 0.12, 'triangle', 0.15, 0, 0.05); },
  hitHead() { tone(1046, 0.1, 'triangle', 0.3); tone(1568, 0.25, 'triangle', 0.25, 0, 0.06); noise(0.1, 0.15, 4000); },
  kill() { tone(523, 0.15, 'triangle', 0.3); tone(784, 0.15, 'triangle', 0.3, 0, 0.1); tone(1046, 0.35, 'triangle', 0.3, 0, 0.2); },
  miss() { tone(180, 0.22, 'sawtooth', 0.18, -60); },
  hurt() { noise(0.18, 0.4, 300, 0.8, 'lowpass'); tone(140, 0.2, 'sine', 0.3, -60); },
  armorBreak() { noise(0.3, 0.3, 2500, 2); },
  pickup() { tone(660, 0.06, 'square', 0.08); tone(990, 0.08, 'square', 0.06, 0, 0.05); },
  deny() { tone(220, 0.1, 'square', 0.08); },
  use() { noise(0.3, 0.08, 1800, 1.5); },
  used() { tone(740, 0.1, 'sine', 0.15); tone(988, 0.15, 'sine', 0.15, 0, 0.08); },
  throw() { noise(0.15, 0.12, 900, 1); },
  flash(d) { const v = Math.max(0.1, 1 - d / 40); noise(0.6, 0.8 * v, 2000, 0.4, 'lowpass'); },
  tinnitus(dur) { tone(3600, dur, 'sine', 0.08); },
  smoke() { noise(1.8, 0.25, 1200, 0.5, 'highpass'); },
  zone() { tone(330, 0.25, 'sine', 0.2); tone(330, 0.25, 'sine', 0.2, 0, 0.35); },
  scan() { tone(1800, 0.05, 'sine', 0.06); },
  scanDone() { tone(1200, 0.08, 'sine', 0.15); tone(1800, 0.12, 'sine', 0.15, 0, 0.08); },
  warn() { tone(980, 0.08, 'square', 0.07); },
  chute() { noise(0.5, 0.3, 500, 0.6); },
  step(pan, vol) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(f); f.connect(g);
    if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = pan; g.connect(pn); pn.connect(master); }
    else g.connect(master);
    s.start(t, Math.random()); s.stop(t + 0.12);
  },
  land() { noise(0.2, 0.3, 200, 0.8, 'lowpass'); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.4, 'triangle', 0.25, 0, i * 0.15)); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.5, 'triangle', 0.22, 0, i * 0.22)); },
};

export function setAmbience(mode) {
  if (!ctx) return;
  if (!wind) wind = loop(0, 'bandpass', 0, 700);
  if (!drone) drone = loop(70, 'lowpass', 0, 200);
  const t = ctx.currentTime;
  const w = mode === 'fall' ? 0.5 : mode === 'chute' ? 0.15 : 0;
  const dr = mode === 'plane' ? 0.35 : 0;
  wind.g.gain.setTargetAtTime(w, t, 0.3);
  drone.g.gain.setTargetAtTime(dr, t, 0.5);
}
