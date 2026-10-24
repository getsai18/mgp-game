import Phaser from 'phaser';

// Calidad gráfica y post-procesado (todo en el navegador: no toca la red ni el servidor).
//   'high': shaders de cámara (viñeta, aberración cromática) y luces.
//   'low':  sin shaders ni luces, para móviles lentos. Se activa sola si los FPS caen un rato.
const STORAGE_KEY = 'mgp-gfx';
const LOW_FPS = 42;
const LOW_FPS_MS = 4000; // tiempo seguido por debajo de LOW_FPS antes de bajar la calidad

let quality = 'high';
let userChose = false; // si el jugador eligió a mano, no se cambia sola
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'high' || saved === 'low') {
    quality = saved;
    userChose = true;
  }
} catch { /* sin almacenamiento */ }

const listeners = new Set();

export const isHighQuality = () => quality === 'high';
export const getQuality = () => quality;

export function setQuality(q, byUser = true) {
  if (q === quality) return;
  quality = q;
  if (byUser) {
    userChose = true;
    try { localStorage.setItem(STORAGE_KEY, q); } catch { /* sin almacenamiento */ }
  }
  for (const fn of listeners) fn(q);
}

export const toggleQuality = () => setQuality(quality === 'high' ? 'low' : 'high');

// La escena se suscribe para reaplicar efectos al cambiar la calidad; devuelve la baja.
export function onQualityChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Llamar cada frame: baja a 'low' si el juego va lento y el jugador no eligió calidad.
let slowSince = 0;
// Con la pestaña oculta el navegador frena los fotogramas: eso no significa que el equipo sea lento.
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => (slowSince = 0));
export function watchFps(game, time) {
  if (userChose || quality === 'low') return;
  if (document.hidden || game.loop.actualFps >= LOW_FPS) {
    slowSince = 0;
  } else if (!slowSince) {
    slowSince = time;
  } else if (time - slowSince > LOW_FPS_MS) {
    setQuality('low', false);
  }
}

const isWebGL = (scene) => scene.sys.game.renderer.type === Phaser.WEBGL;

// ------------------------------------------------------------ aberración cromática
// Separa los canales rojo y azul hacia fuera desde el centro. `amount` 0 = sin efecto.
const CHROMA_FRAG = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform float uAmount;
varying vec2 outTexCoord;
void main() {
  vec2 off = (outTexCoord - 0.5) * uAmount;
  vec4 c = texture2D(uMainSampler, outTexCoord);
  float r = texture2D(uMainSampler, outTexCoord + off).r;
  float b = texture2D(uMainSampler, outTexCoord - off).b;
  gl_FragColor = vec4(r, c.g, b, c.a);
}`;

export class ChromaticFX extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game) {
    super({ game, name: 'ChromaticFX', fragShader: CHROMA_FRAG });
    this.amount = 0;
  }

  onPreRender() {
    this.set1f('uAmount', this.amount);
  }
}

// Efectos fijos de la cámara del mundo (la cámara de interfaz no los lleva: el HUD queda nítido).
// Devuelve el pipeline de aberración (o null si no hay WebGL / calidad baja).
export function applyCameraFX(scene, cam) {
  cam.postFX?.clear();
  cam.resetPostPipeline?.();
  if (!isWebGL(scene) || !isHighQuality()) return null;
  // Sin bloom: el de Phaser no tiene umbral y emborrona todo el pixel art. El brillo lo dan las luces aditivas.
  cam.postFX.addVignette(0.5, 0.5, 0.92, 0.22);
  cam.setPostPipeline(ChromaticFX);
  return cam.getPostPipeline(ChromaticFX);
}
