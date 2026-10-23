import { ZZFX, ZZFXSound } from 'zzfx';
import { GAME_WIDTH } from './level.js';

// Sonido 100% generado en el navegador (sin archivos):
//  - efectos con ZzFX (MIT, <1 KB): cada sonido se precalcula una vez y se reproduce con paneo
//    según la posición X en pantalla.
//  - música chiptune con osciladores WebAudio y un secuenciador con planificación anticipada.
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

export function play(name, x = GAME_WIDTH / 2, volume = 1) {
  if (muted || ZZFX.audioContext.state !== 'running') return;
  const sound = ensureSfx()[name];
  if (!sound) return;
  const pan = Math.max(-0.8, Math.min(0.8, (x / GAME_WIDTH) * 2 - 1));
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

// ------------------------------------------------------------------ música
const MUSIC_VOLUME = 0.07;
const BPM = 140;
const STEP = 60 / BPM / 4; // semicorcheas
// Progresión i - VI - III - VII (menor, épica) con arpegio y bajo; cada mapa la transpone.
const CHORDS = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
const music = { gain: null, timer: null, step: 0, nextTime: 0, root: 57 };

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

function note(ctx, type, midi, time, length, volume) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq(midi);
  env.gain.setValueAtTime(volume, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + length);
  osc.connect(env).connect(music.gain);
  osc.start(time);
  osc.stop(time + length + 0.02);
}

function scheduleMusic() {
  const ctx = ZZFX.audioContext;
  while (music.nextTime < ctx.currentTime + 0.25) {
    const s = music.step;
    const chord = CHORDS[Math.floor(s / 32) % CHORDS.length];
    const t = music.nextTime;
    note(ctx, 'square', music.root + 12 + chord[ARP[s % 8]], t, STEP * 0.9, 0.5);
    if (s % 4 === 0) note(ctx, 'triangle', music.root - 12 + chord[0], t, STEP * 3.5, 1);
    if (s % 8 === 4) note(ctx, 'sawtooth', music.root - 24 + chord[0], t, STEP * 0.6, 0.25); // golpe de "caja"
    music.step++;
    music.nextTime += STEP;
  }
}

export function startMusic(variant = 0) {
  const ctx = ZZFX.audioContext;
  if (!music.gain) {
    music.gain = ctx.createGain();
    music.gain.connect(ctx.destination);
  }
  music.gain.gain.value = muted ? 0 : MUSIC_VOLUME;
  music.root = [57, 55, 52][variant % 3]; // La / Sol / Mi menor según el mapa
  if (music.timer) return;
  music.step = 0;
  music.nextTime = ctx.currentTime + 0.05;
  music.timer = setInterval(scheduleMusic, 80);
}

export function stopMusic() {
  clearInterval(music.timer);
  music.timer = null;
}
