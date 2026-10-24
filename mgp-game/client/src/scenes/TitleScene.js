import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from '../level.js';
import { MAPS } from '../maps.js';
import { drawMapBackground } from '../mapTiles.js';
import { bake } from '../systems/Juice.js';
import { skinKey, PLAYER_COLORS } from '../skins.js';
import { session } from '../net.js';
import { unlockAudio, play, toggleMute, isMuted } from '../audio.js';
import { isTouch, enterFullscreen } from '../touch.js';
import { setDebugState } from '../debugState.js';

export const GAME_TITLE = 'ARENA CAOS';
const NAME_MAX = 12;

// Pantalla de título: nombre del jugador y modo (online / práctica sin conexión).
export default class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    this.starting = false;
    // El lienzo es RENDER_SCALE veces la interfaz: con este zoom el menú se sigue maquetando en 960x540.
    this.cameras.main.setZoom(RENDER_SCALE).centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    // Fondo del primer mapa reducido a la vista (con el zoom de la cámara queda píxel a píxel).
    const map = MAPS[0];
    const bg = drawMapBackground(this, map);
    const fit = GAME_WIDTH / map.width;
    bake(this, bg.far, map.width, map.height).setScale(fit);
    bake(this, bg.near, map.width, map.height).setScale(fit);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0b14, 0.35);
    this.add.particles(0, 0, 'pixel', {
      x: { min: 0, max: GAME_WIDTH }, y: -10, speedY: { min: 25, max: 60 }, speedX: { min: -20, max: 20 },
      lifespan: 14000, scale: { min: 0.4, max: 1 }, tint: 0xffffff, frequency: 60,
    });

    this.createLogo();
    this.createHeroes();
    this.createNameInput();
    this.createButtons();

    const help = isTouch
      ? '◀ ▶ mover · ▼ bajar/apuntar abajo · ⤒ saltar · ✹ disparar · E arma · ☺ burla'
      : 'Teclado: A/D mover · W saltar · S agacharse/apuntar abajo · F disparar · E cambiar arma · Q burla\n' +
        'Mando: stick/cruceta · A saltar · X disparar · Y arma · LB burla      Móvil: botones en pantalla';
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 44, help,
      { fontFamily: 'monospace', fontSize: isTouch ? '16px' : '12px', color: '#e8eef8', align: 'center', stroke: '#000000', strokeThickness: 3 },
    ).setOrigin(0.5);

    this.muteText = this.add.text(GAME_WIDTH - 10, 10, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', stroke: '#000', strokeThickness: 3 })
      .setOrigin(1, 0).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.toggleSound());
    this.renderMute();
    this.input.keyboard.on('keydown-N', () => this.toggleSound());
    this.input.keyboard.on('keydown-ENTER', () => this.start('online'));
    this.input.gamepad?.once('down', () => this.start('online'));
    for (const o of this.children.list) o.setResolution?.(RENDER_SCALE); // textos nítidos con el zoom
    setDebugState({ scene: 'title' });
  }

  createLogo() {
    const logo = this.add.text(GAME_WIDTH / 2, 110, GAME_TITLE, {
      fontFamily: 'monospace', fontSize: '72px', fontStyle: 'bold', color: '#ffffff', stroke: '#1b1d3a', strokeThickness: 10,
    }).setOrigin(0.5).setShadow(6, 6, '#000000', 0, true, true);
    this.tweens.add({ targets: logo, scale: 1.05, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.text(GAME_WIDTH / 2, 168, '1 VS 1 · ARMAS LOCAS · CAOS TOTAL', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffd27a', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);
  }

  createHeroes() {
    [[200, 0, false], [GAME_WIDTH - 200, 1, true]].forEach(([x, skin, flip], i) => {
      const hero = this.add.image(x, 300, skinKey(skin, 'idle', true)).setScale(5).setFlipX(flip);
      const gun = this.add.image(x + (flip ? -45 : 45), 315, i ? 'rocket' : 'shotgun').setScale(4).setFlipX(flip);
      this.tweens.add({ targets: [hero, gun], y: '-=8', duration: 700 + i * 120, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.add.text(x, 400, `JUGADOR ${i + 1}`, {
        fontFamily: 'monospace', fontSize: '14px', color: `#${PLAYER_COLORS[skin].toString(16)}`, stroke: '#000', strokeThickness: 4,
      }).setOrigin(0.5);
    });
  }

  createNameInput() {
    let saved = '';
    try { saved = localStorage.getItem('mgp-name') || ''; } catch { /* sin almacenamiento */ }
    this.add.text(GAME_WIDTH / 2, 232, 'TU NOMBRE', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    this.nameInput = this.add.dom(GAME_WIDTH / 2, 262, 'input', [
      'width: 220px', 'padding: 6px 10px', 'font: bold 18px monospace', 'text-align: center',
      'border: 3px solid #1b1d3a', 'border-radius: 6px', 'background: #f4f8ff', 'color: #1b1d3a', 'outline: none',
    ].join(';'));
    const el = this.nameInput.node;
    el.maxLength = NAME_MAX;
    el.placeholder = 'Soldado';
    el.value = saved;
    el.addEventListener('keydown', (e) => e.stopPropagation()); // que escribir "W" no active atajos
    el.addEventListener('keydown', (e) => e.key === 'Enter' && this.start('online'));
  }

  createButtons() {
    this.button(GAME_WIDTH / 2, 306, '▶ PARTIDA RÁPIDA', '#2e7d32', () => this.start('online'));
    this.button(GAME_WIDTH / 2, 350, '🔒 SALA PRIVADA', '#1f5fa8', () => this.start('lobby'));
    this.button(GAME_WIDTH / 2, 394, '🤖 VS BOT', '#8e2c2c', () => this.start('bot'));
    this.button(GAME_WIDTH / 2, 438, 'PRÁCTICA (SOLO)', '#37474f', () => this.start('offline'));
  }

  button(x, y, label, bg, onClick) {
    const b = this.add.text(x, y, label, {
      fontFamily: 'monospace', fontSize: '22px', fontStyle: 'bold', color: '#ffffff', backgroundColor: bg,
      padding: { x: 18, y: 8 }, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    b.on('pointerover', () => this.tweens.add({ targets: b, scale: 1.08, duration: 90 }));
    b.on('pointerout', () => this.tweens.add({ targets: b, scale: 1, duration: 90 }));
    b.on('pointerdown', onClick);
    return b;
  }

  toggleSound() {
    unlockAudio();
    toggleMute();
    this.renderMute();
    play('click');
  }

  renderMute() {
    this.muteText.setText(isMuted() ? '🔇 SONIDO (N)' : '🔊 SONIDO (N)');
  }

  start(mode) {
    if (this.starting) return;
    this.starting = true;
    unlockAudio(); // primer gesto del usuario: ya se puede reproducir audio
    enterFullscreen(); // móvil: pantalla completa y horizontal (necesita este mismo toque)
    play('click');
    const name = (this.nameInput.node.value || '').trim().slice(0, NAME_MAX) || 'Soldado';
    session.name = name;
    try { localStorage.setItem('mgp-name', name); } catch { /* sin almacenamiento */ }
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => (mode === 'lobby' ? this.scene.start('Lobby') : this.scene.start('Arena', { mode })));
  }
}
