import Phaser from 'phaser';
import { generateSkinTextures } from '../skins.js';

// Genera todas las texturas por código: no hay assets que cargar.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    const g = this.make.graphics({ add: false });

    // Partícula genérica (chispa / burbuja de lava / polvo).
    g.fillStyle(0xffffff).fillRect(0, 0, 4, 4);
    g.generateTexture('pixel', 4, 4);
    g.clear();

    // Personajes (soldado chibi con armadura; pañuelo y luces del color del jugador).
    generateSkinTextures(this);

    // Humo / fuego suave.
    g.fillStyle(0xffffff, 0.5).fillCircle(4, 4, 4);
    g.fillStyle(0xffffff).fillCircle(4, 4, 2.5);
    g.generateTexture('puff', 8, 8);
    g.clear();

    // --- Armas (apuntando a la derecha) ---
    g.fillStyle(0xcfcfdf).fillRect(0, 1, 14, 4); // pistola
    g.fillStyle(0x55556a).fillRect(2, 4, 4, 4);
    g.fillStyle(0x222233).fillRect(12, 2, 2, 2);
    g.generateTexture('pistol', 14, 8);
    g.clear();

    g.fillStyle(0x8b5a2b).fillRect(0, 2, 8, 5); // escopeta
    g.fillStyle(0xa0a0b0).fillRect(6, 1, 18, 3);
    g.fillStyle(0x666677).fillRect(12, 4, 7, 2);
    g.generateTexture('shotgun', 24, 7);
    g.clear();

    g.fillStyle(0x4d6b2f).fillRect(2, 1, 22, 6); // lanzacohetes
    g.fillStyle(0x2c3d1b).fillRect(2, 1, 22, 2);
    g.fillStyle(0x333333).fillRect(22, 0, 4, 8);
    g.fillStyle(0x222222).fillRect(9, 7, 3, 3);
    g.generateTexture('rocket', 26, 10);
    g.clear();

    // --- Proyectiles ---
    g.fillStyle(0xffee88).fillRect(0, 0, 8, 2);
    g.generateTexture('bullet', 8, 2);
    g.clear();
    g.fillStyle(0xffaa33).fillRect(0, 0, 4, 3);
    g.generateTexture('pellet', 4, 3);
    g.clear();
    g.fillStyle(0xdddddd).fillRect(2, 1, 8, 3);
    g.fillStyle(0xff3333).fillRect(10, 1, 2, 3);
    g.fillStyle(0x888888).fillRect(0, 0, 3, 5);
    g.generateTexture('rocket_proj', 12, 5);
    g.clear();

    // Casquillos.
    g.fillStyle(0xe8c050).fillRect(0, 0, 3, 2);
    g.generateTexture('casing', 3, 2);
    g.clear();
    g.fillStyle(0xcc2222).fillRect(0, 0, 4, 3);
    g.fillStyle(0xe8c050).fillRect(0, 0, 1, 3);
    g.generateTexture('shell', 4, 3);
    g.clear();

    g.destroy();
    this.scene.start('Arena');
  }
}
