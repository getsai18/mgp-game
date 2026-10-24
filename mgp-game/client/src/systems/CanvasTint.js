import Phaser from 'phaser';

// El juego se dibuja con el renderizador Canvas 2D de Phaser, que no aplica tintes (setTint, tint de
// partículas): sin esto la sangre, el fuego y las luces saldrían blancos. Aquí, la primera vez que se
// pide un color sobre una textura se hace una copia teñida en un <canvas> y desde entonces se dibuja
// esa copia (mismo coste que la original). Los colores se redondean a 4 bits por canal: como mucho
// 4096 copias por textura, y en la práctica unas pocas (las paletas son fijas).
const MAX_PIXELS = 512 * 512; // texturas grandes (fondos horneados) no se tiñen nunca
const copies = new WeakMap(); // frame original -> Map(color -> frame teñido)
let seq = 0;

const quantize = (c) => (c & 0xf0f0f0) | ((c & 0xf0f0f0) >> 4);
const css = (c) => `#${c.toString(16).padStart(6, '0')}`;

function tintedFrame(frame, color, fill) {
  const tex = frame.texture;
  const image = frame.source.image;
  if (!image || tex instanceof Phaser.Textures.DynamicTexture || image.width * image.height > MAX_PIXELS) return frame;
  const key = fill ? -1 - color : color;
  let byColor = copies.get(frame);
  if (!byColor) copies.set(frame, (byColor = new Map()));
  let out = byColor.get(key);
  if (out) return out;

  const { width, height } = image;
  const copy = tex.manager.createCanvas(`__tint${++seq}`, width, height);
  const ctx = copy.getContext();
  ctx.drawImage(image, 0, 0);
  if (fill) {
    // setTintFill: la silueta entera de un color (destello al recibir un golpe).
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = css(color);
    ctx.fillRect(0, 0, width, height);
  } else {
    // setTint: multiplica el color y recupera la transparencia original.
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = css(color);
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(image, 0, 0);
  }
  copy.refresh();
  out = frame.name === '__BASE' ? copy.get() : copy.add(frame.name, 0, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight);
  byColor.set(key, out);
  return out;
}

// Sprites, imágenes y rectángulos de imagen.
const renderer = Phaser.Renderer.Canvas.CanvasRenderer.prototype;
const batchSprite = renderer.batchSprite;
renderer.batchSprite = function (sprite, frame, camera, parentMatrix) {
  // Text.setResolution() solo cambia style.resolution; el Canvas escala con la de la textura (WebGL
  // usa la del estilo). Sin esto los textos nítidos (resolución 1.5) salen 1.5 veces más grandes.
  if (sprite.type === 'Text') frame.source.resolution = sprite.style.resolution;
  const tint = sprite.tintTopLeft;
  if (frame && sprite.type !== 'Text' && (sprite.tintFill || (tint !== undefined && tint !== 0xffffff))) {
    frame = tintedFrame(frame, quantize(tint), sprite.tintFill);
  }
  return batchSprite.call(this, sprite, frame, camera, parentMatrix);
};

// Partículas: se cambia el frame de cada partícula teñida solo mientras se dibuja.
const emitter = Phaser.GameObjects.Particles.ParticleEmitter.prototype;
const renderParticles = emitter.renderCanvas;
emitter.renderCanvas = function (r, src, camera, parentMatrix) {
  const swapped = [];
  for (const p of src.alive) {
    if (p.tint !== 0xffffff) {
      swapped.push(p, p.frame);
      p.frame = tintedFrame(p.frame, quantize(p.tint), false);
    }
  }
  renderParticles.call(this, r, src, camera, parentMatrix);
  for (let i = 0; i < swapped.length; i += 2) swapped[i].frame = swapped[i + 1];
};

// Phaser decide al arrancar si el Canvas admite 'multiply', 'screen'... con una prueba asíncrona que
// a veces no ha terminado: entonces los deja en 'source-over' y la capa de oscuridad de Lights.js
// tapa el mapa. Todos los navegadores actuales los admiten: se fijan a mano.
const NEW_MODES = {
  MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEN: 'darken', LIGHTEN: 'lighten',
  COLOR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light',
  DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
};
export function fixCanvasBlendModes(game) {
  const modes = game.renderer?.type === Phaser.CANVAS && game.renderer.blendModes;
  if (!modes) return;
  for (const [name, op] of Object.entries(NEW_MODES)) modes[Phaser.BlendModes[name]] = op;
}
