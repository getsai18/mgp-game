import { ZZFX, ZZFXSound } from 'zzfx';
import { GAME_WIDTH } from './level.js';

// Sonido 100% generado en el navegador (sin archivos):
//  - efectos con ZzFX (MIT, <1 KB): cada sonido se precalcula una vez y se reproduce con paneo
//    según la posición X en pantalla.
//  - música de acción y voces (quejidos) con nodos WebAudio y un secuenciador con planificación anticipada.
// Parámetros ZzFX: [volumen, aleatoriedad, frecuencia, ataque, sostén, caída, forma, curva, deslizamiento,
//   deltaDesliz, saltoTono, tiempoSalto, repetición, ruido, modulación, bitCrush, retardo, volSostén, decay, trémolo, filtro]
const SFX_DEFS = {
  pistol: [0.6, 0.05, 420, 0, 0.02, 0.09, 4, 1.6, -7, 0, 0, 0, 0, 0.6, 0, 0.1],
  shotgun: [1.1, 0.05, 110, 0, 0.06, 0.32, 4, 2.2, -2, 0, 0, 0, 0, 1.4, 0, 0.35],
  rocket: [0.7, 0.05, 160, 0.03, 0.18, 0.35, 4, 1, 4, 0, 0, 0, 0, 0.8, 0, 0.2],
  explosion: [1.4, 0.1, 55, 0.01, 0.25, 0.9, 4, 0.6, -1, 0, 0, 0, 0, 2.2, 0, 0.5, 0, 0.6],
  jump: [0.25, 0.05, 260, 0, 0.03, 0.09, 1, 1.4, 14],
  land: [0.18, 0.1, 80, 0, 0.01, 0.05, 4, 1, -2, 0, 0, 0, 0, 0.5],
  hit: [0.7, 0.1, 190, 0, 0.02, 0.13, 3, 1.2, -12, 0, 0, 0, 0, 0.6, 0, 0.2],
  death: [0.8, 0.05, 520, 0.01, 0.12, 0.55, 2, 1.2, -14, 0, 0, 0, 0, 0.2],
  splash: [0.8, 0.2, 700, 0.02, 0.1, 0.45, 4, 1, -4, 0, 0, 0, 0, 1],
  fall: [0.5, 0, 900, 0.05, 0.3, 0.4, 1, 1, -18],
  pickup: [0.45, 0, 620, 0, 0.04, 0.12, 1, 1.5, 0, 0, 340, 0.05],
  spawn: [0.25, 0, 880, 0, 0.05, 0.2, 0, 1, 0, 0, 220, 0.06],
  empty: [0.35, 0, 1400, 0, 0, 0.03, 2, 1, -20],
  round: [0.5, 0, 520, 0.01, 0.12, 0.35, 1, 1, 0, 0, 260, 0.12],
  win: [0.6, 0, 440, 0.01, 0.2, 0.5, 2, 1.5, 0, 0, 220, 0.1, 0.12],
  taunt: [0.6, 0.1, 300, 0.02, 0.15, 0.25, 2, 2, 6, 0, 0, 0, 0.08, 0, 6],
  throw: [0.4, 0.05, 300, 0, 0.05, 0.1, 4, 1, 10, 0, 0, 0, 0, 0.5],
  bonk: [0.8, 0.1, 140, 0, 0.03, 0.15, 3, 1, -6, 0, 0, 0, 0, 0.3, 0, 0.3],
  click: [0.3, 0, 900, 0, 0.01, 0.04, 1],
};

let sfx = null;
let muted = false;
try { muted = localStorage.getItem('mgp-muted') === '1'; } catch { /* sin almacenamiento */ }

function ensureSfx() {
  if (!sfx) sfx = Object.fromEntries(Object.entries(SFX_DEFS).map(([k, def]) => [k, new ZZFXSound([...def])]));
  return sfx;
}

// Los navegadores arrancan el audio "suspendido" hasta el primer gesto del usuario.
export function unlockAudio() {
  ensureSfx();
  if (ZZFX.audioContext.state !== 'running') ZZFX.audioContext.resume();
}

// Paneo relativo a lo que enseña la cámara (la escena de juego la registra); sin cámara, la pantalla.
let listener = null;
export function setAudioListener(cam) {
  listener = cam;
}

export function play(name, x, volume = 1) {
  if (muted || ZZFX.audioContext.state !== 'running') return;
  const sound = ensureSfx()[name];
  if (!sound) return;
  const view = listener?.worldView;
  const rel = x === undefined ? 0 : view?.width ? (x - view.centerX) / (view.width / 2) : (x / GAME_WIDTH) * 2 - 1;
  const pan = Math.max(-0.8, Math.min(0.8, rel));
  sound.play(volume, 1, 1, pan);
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('mgp-muted', muted ? '1' : '0'); } catch { /* sin almacenamiento */ }
  music.gain && (music.gain.gain.value = muted ? 0 : MUSIC_VOLUME);
  return muted;
}

// ------------------------------------------------------------------- voces
// Quejidos estilo arcade ("¡ugh!", "¡aargh!") sintetizados: diente de sierra con la voz grave que
// cae de tono, pasado por dos filtros de formantes (las "vocales") y un soplo de ruido.
// pitch: 1 = voz del jugador 1; el 2 suena algo más agudo para distinguirlos.
const VOICES = {
  hurt: { f0: 150, dur: 0.2, slide: 0.62, formants: [[620, 7], [1050, 9]], breath: 0.25, vol: 0.55 },
  death: { f0: 210, dur: 0.6, slide: 0.45, formants: [[780, 6], [1250, 8]], breath: 0.35, vol: 0.6, wobble: 9 },
  fall: { f0: 330, dur: 1.1, slide: 0.35, formants: [[820, 6], [1300, 8]], breath: 0.2, vol: 0.45, wobble: 6 },
};
let noiseBuf = null;

function noiseBuffer(ctx) {
  if (noiseBuf?.sampleRate === ctx.sampleRate) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

// Dibuja una voz en `out` a partir del instante t (también sirve con OfflineAudioContext).
export function renderVoice(ctx, out, t, kind, pitch = 1) {
  const v = VOICES[kind];
  const f0 = v.f0 * pitch * (0.92 + Math.random() * 0.16);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(v.vol, t + 0.015);
  env.gain.setValueAtTime(v.vol, t + v.dur * 0.35);
  env.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);
  env.connect(out);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * v.slide, t + v.dur);
  if (v.wobble) { // temblor de la voz (grito)
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = v.wobble;
    depth.gain.value = f0 * 0.06;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + v.dur + 0.05);
  }
  for (const [f, q] of v.formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * (0.95 + pitch * 0.05);
    bp.Q.value = q;
    osc.connect(bp).connect(env);
  }
  const low = ctx.createGain(); // algo de cuerpo grave sin filtrar
  low.gain.value = 0.08;
  osc.connect(low).connect(env);
  osc.start(t);
  osc.stop(t + v.dur + 0.05);

  const breath = ctx.createBufferSource();
  breath.buffer = noiseBuffer(ctx);
  const bf = ctx.createBiquadFilter();
  bf.type = 'bandpass';
  bf.frequency.value = 1600;
  bf.Q.value = 1.2;
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(v.breath, t);
  bg.gain.exponentialRampToValueAtTime(0.001, t + v.dur * 0.6);
  breath.connect(bf).connect(bg).connect(env);
  breath.start(t);
  breath.stop(t + v.dur);
}

export function playVoice(kind, x, pitch = 1) {
  const ctx = ZZFX.audioContext;
  if (muted || ctx.state !== 'running' || !VOICES[kind]) return;
  const view = listener?.worldView;
  const pan = ctx.createStereoPanner();
  pan.pan.value = view?.width && x !== undefined ? Math.max(-0.8, Math.min(0.8, (x - view.centerX) / (view.width / 2))) : 0;
  const vol = ctx.createGain();
  vol.gain.value = VOICE_VOLUME;
  pan.connect(vol).connect(ctx.destination);
  renderVoice(ctx, pan, ctx.currentTime + 0.005, kind, pitch);
  setTimeout(() => vol.disconnect(), (VOICES[kind].dur + 0.3) * 1000);
}
const VOICE_VOLUME = 1.9; // los filtros de formantes atenúan mucho: así quedan al nivel de los efectos ZzFX

// ------------------------------------------------------------------ música
// Tema de acción (metal chiptune) a 150 BPM, todo sintetizado: batería (bombo, caja, platillos con
// ruido), bajo, guitarra rítmica con distorsión (power chords "chug") y melodía principal.
// Forma de 16 compases que se repite: riff (4) -> riff + melodía (4) -> estribillo (7) -> redoble (1).
// Cada mapa lo transpone. En el punto de partido (alguien a una ronda de ganar) sube la intensidad.
const MUSIC_VOLUME = 0.17;
const BPM = 150;
const STEP = 60 / BPM / 4; // semicorcheas
const BAR = 16;
const FORM = 16; // compases por vuelta
// Acorde (semitonos sobre la tónica) de cada compás.
const PROGRESSION = [0, 0, -4, -2, 0, 0, 3, -2, -4, -2, 0, 3, -4, -2, 0, 0];
const CHUG = [1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0]; // golpes de guitarra por semicorchea
// Melodía: [paso dentro de la frase de 2 compases, semitono, duración en pasos].
const LEAD_A = [
  [[0, 7, 2], [2, 10, 2], [4, 12, 4], [8, 10, 2], [10, 7, 2], [12, 8, 4], [16, 7, 2], [18, 5, 2], [20, 3, 4], [24, 2, 2], [26, 3, 2], [28, 5, 4]],
  [[0, 7, 2], [2, 10, 2], [4, 12, 4], [8, 15, 4], [12, 14, 2], [14, 12, 2], [16, 10, 6], [22, 7, 2], [24, 10, 8]],
];
const LEAD_B = [
  [[0, 12, 4], [4, 15, 4], [8, 14, 2], [10, 12, 2], [12, 10, 4], [16, 8, 4], [20, 10, 4], [24, 12, 8]],
  [[0, 12, 4], [4, 15, 4], [8, 17, 4], [12, 19, 4], [16, 17, 4], [20, 15, 2], [22, 14, 2], [24, 12, 8]],
];
const ROOTS = [57, 55, 52, 50, 53, 54]; // La, Sol, Mi, Re, Fa, Fa# (menor) según el mapa
const music = { gain: null, mix: null, guitar: null, timer: null, step: 0, nextTime: 0, root: 57, intense: false };

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

function distortionCurve(k) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

// Buses de la música: guitarra con distorsión y todo a un compresor (pegamento) antes del volumen.
function buildBus(ctx, destination) {
  const gain = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.15;
  comp.connect(gain).connect(destination);
  const shaper = ctx.createWaveShaper();
  shaper.curve = distortionCurve(30);
  shaper.oversample = '2x';
  const toneFilter = ctx.createBiquadFilter();
  toneFilter.type = 'lowpass';
  toneFilter.frequency.value = 2600;
  const guitar = ctx.createGain();
  guitar.gain.value = 0.5;
  guitar.connect(shaper).connect(toneFilter).connect(comp);
  return { gain, mix: comp, guitar };
}

function tone(ctx, out, type, midi, time, length, volume, detune = 0) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq(midi);
  osc.detune.value = detune;
  env.gain.setValueAtTime(volume, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + length);
  osc.connect(env).connect(out);
  osc.start(time);
  osc.stop(time + length + 0.02);
}

function kick(ctx, out, t, vol = 1) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  env.gain.setValueAtTime(vol, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + 0.32);
}

function noiseHit(ctx, out, t, { type, f, q = 1, vol, len }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = f;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(vol, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(filter).connect(env).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + len + 0.02);
}

function snare(ctx, out, t, vol = 1) {
  noiseHit(ctx, out, t, { type: 'bandpass', f: 1900, q: 0.8, vol: 0.9 * vol, len: 0.17 });
  tone(ctx, out, 'triangle', 50, t, 0.08, 0.5 * vol);
}

// Programa un paso (semicorchea) de la canción en el bus de mezcla y el de guitarra distorsionada.
function scheduleStep(ctx, bus, s, t, root, intense) {
  const bar = Math.floor(s / BAR) % FORM;
  const i = s % BAR;
  const chord = root + PROGRESSION[bar];
  const fill = bar === FORM - 1;
  const chorus = bar >= 8 && bar < 15;
  const out = bus.mix;

  // Batería.
  if (fill && i >= 8) {
    snare(ctx, out, t, 0.55 + (i - 8) * 0.06);
    if (i % 2 === 0) kick(ctx, out, t, 0.8);
  } else {
    if (i === 0 || i === 8 || i === 6 || (i === 10 && chorus) || (intense && i === 14)) kick(ctx, out, t, 0.95);
    if (i === 4 || i === 12) snare(ctx, out, t);
    if (i % 2 === 0 || intense || chorus) noiseHit(ctx, out, t, { type: 'highpass', f: 7500, vol: i % 4 === 2 ? 0.28 : 0.16, len: 0.035 });
  }
  if (i === 0 && (bar === 0 || bar === 8)) noiseHit(ctx, out, t, { type: 'highpass', f: 4000, vol: 0.4, len: 1.4 }); // platillo

  // Bajo: corcheas con la tónica del acorde (octava arriba en los contratiempos del estribillo).
  if (i % 2 === 0) tone(ctx, out, 'sawtooth', chord - 24 + (chorus && i % 4 === 2 ? 12 : 0), t, STEP * 1.6, 0.22);

  // Guitarra rítmica: power chord (tónica + quinta + octava) apagado; acento largo al cambiar de acorde.
  if (CHUG[i]) {
    const len = i === 0 ? STEP * 3.5 : STEP * 0.7;
    for (const n of [0, 7, 12]) {
      tone(ctx, bus.guitar, 'sawtooth', chord - 12 + n, t, len, 0.18, -7);
      tone(ctx, bus.guitar, 'square', chord - 12 + n, t, len, 0.1, 7);
    }
  }

  // Melodía (compases 4-14): cuadrada con vibrato y un refuerzo una octava abajo.
  if (bar >= 4 && bar < 15) {
    const phrases = chorus ? LEAD_B : LEAD_A;
    const phrase = phrases[Math.floor(bar / 2) % 2];
    const local = (bar % 2) * BAR + i;
    for (const [at, semi, len] of phrase) {
      if (at !== local) continue;
      const midi = root + 12 + semi + (intense ? 12 : 0);
      const dur = STEP * len * 0.95;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const vib = ctx.createOscillator();
      const vibDepth = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq(midi);
      vib.frequency.value = 6;
      vibDepth.gain.setValueAtTime(0, t);
      vibDepth.gain.linearRampToValueAtTime(freq(midi) * 0.012, t + dur);
      vib.connect(vibDepth).connect(osc.frequency);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.13, t + 0.01);
      env.gain.setValueAtTime(0.13, t + dur * 0.7);
      env.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(env).connect(out);
      for (const o of [osc, vib]) {
        o.start(t);
        o.stop(t + dur + 0.02);
      }
      tone(ctx, out, 'triangle', midi - 12, t, dur, 0.1);
    }
  }
}

function scheduleMusic() {
  const ctx = ZZFX.audioContext;
  // Pestaña en segundo plano: el temporizador se frena; no amontonar notas atrasadas al volver.
  if (music.nextTime < ctx.currentTime - 0.2) music.nextTime = ctx.currentTime + 0.05;
  while (music.nextTime < ctx.currentTime + 0.25) {
    scheduleStep(ctx, music, music.step, music.nextTime, music.root, music.intense);
    music.step++;
    music.nextTime += STEP;
  }
}

export function startMusic(variant = 0) {
  const ctx = ZZFX.audioContext;
  if (!music.gain) Object.assign(music, buildBus(ctx, ctx.destination));
  music.gain.gain.value = muted ? 0 : MUSIC_VOLUME;
  music.root = ROOTS[variant % ROOTS.length];
  if (music.timer) return;
  music.step = 0;
  music.nextTime = ctx.currentTime + 0.05;
  music.timer = setInterval(scheduleMusic, 80);
}

// Punto de partido: batería más cargada y la melodía una octava arriba.
export function setMusicIntensity(intense) {
  music.intense = !!intense;
}

export function stopMusic() {
  clearInterval(music.timer);
  music.timer = null;
}

// Pruebas sin escuchar: renderiza `bars` compases (o una voz) en un OfflineAudioContext para medir niveles.
export async function renderOffline(what = 'music', { bars = 16, root = 57, intense = false, pitch = 1 } = {}) {
  const len = what === 'music' ? bars * BAR * STEP + 1 : 1.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(len * 44100), 44100);
  if (what === 'music') {
    const bus = buildBus(ctx, ctx.destination);
    bus.gain.gain.value = MUSIC_VOLUME;
    for (let s = 0; s < bars * BAR; s++) scheduleStep(ctx, bus, s, s * STEP + 0.05, root, intense);
  } else {
    const vol = ctx.createGain();
    vol.gain.value = VOICE_VOLUME;
    vol.connect(ctx.destination);
    renderVoice(ctx, vol, 0.05, what, pitch);
  }
  return ctx.startRendering();
}
