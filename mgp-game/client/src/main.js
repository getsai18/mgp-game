import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './level.js';
import BootScene from './scenes/BootScene.js';
import TitleScene from './scenes/TitleScene.js';
import ArenaScene from './scenes/ArenaScene.js';
import LobbyScene from './scenes/LobbyScene.js';
import { socket, session } from './net.js';
import { ChromaticFX } from './systems/Gfx.js';
import { fixCanvasBlendModes } from './systems/CanvasTint.js'; // tintes y mezclas en Canvas 2D

const game = new Phaser.Game({
  // Canvas 2D de HTML5 (lineamiento). Los shaders de Gfx.js solo se activan con WebGL: aquí quedan apagados.
  type: Phaser.CANVAS,
  parent: 'game',
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  backgroundColor: '#0b0b14',
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 1400 }, debug: false },
  },
  input: { gamepad: true },
  dom: { createContainer: true }, // campo de nombre en la pantalla de título
  pipeline: { ChromaticFX }, // shader propio de post-procesado (systems/Gfx.js)
  scene: [BootScene, TitleScene, LobbyScene, ArenaScene],
});

fixCanvasBlendModes(game);

// Acceso desde la consola, solo en desarrollo.
if (import.meta.env.DEV) Object.assign(window, { game, socket, session });
// Ganchos de las pruebas E2E (tests/e2e): solo lectura del estado y cambio de escena.
Object.assign(window, { __game: game, __socket: socket });
