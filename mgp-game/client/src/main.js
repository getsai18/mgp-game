import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './level.js';
import BootScene from './scenes/BootScene.js';
import TitleScene from './scenes/TitleScene.js';
import ArenaScene from './scenes/ArenaScene.js';
import { socket, session } from './net.js';
import { ChromaticFX } from './systems/Gfx.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
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
  scene: [BootScene, TitleScene, ArenaScene],
});

// Acceso desde la consola / pruebas automáticas, solo en desarrollo.
if (import.meta.env.DEV) Object.assign(window, { game, socket, session });
