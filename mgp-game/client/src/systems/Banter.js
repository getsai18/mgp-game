import Phaser from 'phaser';
import { GAME_WIDTH } from '../level.js';
import { socket, send } from '../net.js';
import { play } from '../audio.js';

export const TAUNTS = ['¡JA!', '¿ESO ES TODO?', '¡VEN AQUÍ!', 'MUY LENTO', '¡GG!', '¡BOOM!', 'NI ME TOCASTE', '¡OTRA VEZ!'];
const TAUNT_COOLDOWN_MS = 1200;
const BUBBLE_MS = 1500;
const FEED_MS = 4500;
const FEED_MAX = 5;

// Burlas con bocadillo (Q / LB / botón ☺) y registro de muertes en pantalla.
// Por red solo viaja el índice de la frase ('player_taunt' { i }); el registro lo arma cada cliente.
export default class Banter {
  constructor(scene) {
    this.scene = scene;
    this.bubbles = []; // { target, text, until }
    this.feedItems = [];
    this.lastTauntAt = -Infinity;

    const onTaunt = (d) => {
      const i = Number(d?.i);
      if (scene.remote && Number.isInteger(i) && TAUNTS[i]) this.show(scene.remote, i);
    };
    socket.on('player_taunt', onTaunt);
    scene.events.once('shutdown', () => socket.off('player_taunt', onTaunt));
  }

  tryTaunt(input, time) {
    const p = this.scene.player;
    if (!input.tauntPressed || !p.alive || time - this.lastTauntAt < TAUNT_COOLDOWN_MS) return;
    this.lastTauntAt = time;
    const i = Phaser.Math.Between(0, TAUNTS.length - 1);
    this.show(p, i);
    send('player_taunt', { i });
  }

  show(target, i) {
    const s = this.scene;
    this.bubbles.filter((b) => b.target === target).forEach((b) => b.text.destroy());
    this.bubbles = this.bubbles.filter((b) => b.target !== target);
    const text = s.add.text(target.x, target.y - 44, TAUNTS[i], {
      fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#111111',
      backgroundColor: '#ffffff', padding: { x: 5, y: 3 },
    }).setOrigin(0.5, 1).setDepth(30).setScale(0).setResolution(2);
    s.tweens.add({ targets: text, scale: 1, duration: 160, ease: 'Back.Out' });
    s.tweens.add({ targets: target, scaleY: 1.25, scaleX: 0.85, duration: 90, yoyo: true, repeat: 1 });
    this.bubbles.push({ target, text, until: s.time.now + BUBBLE_MS });
    play('taunt', target.x, 0.8);
  }

  feed(text, color = '#ffffff') {
    const s = this.scene;
    const item = s.juice.ui(s.add.text(GAME_WIDTH - 10, 0, text, {
      fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(100).setAlpha(0));
    s.tweens.add({ targets: item, alpha: 1, duration: 150 });
    item.until = s.time.now + FEED_MS;
    this.feedItems.unshift(item);
    while (this.feedItems.length > FEED_MAX) this.feedItems.pop().destroy();
    this.layoutFeed();
  }

  layoutFeed() {
    this.feedItems.forEach((item, i) => item.setY(30 + i * 16));
  }

  update(time) {
    this.bubbles = this.bubbles.filter((b) => {
      const alive = time < b.until && b.target.active && b.target.visible;
      if (!alive) b.text.destroy();
      else b.text.setPosition(b.target.x, b.target.y - 44);
      return alive;
    });
    const before = this.feedItems.length;
    this.feedItems = this.feedItems.filter((item) => {
      if (time < item.until) return true;
      item.destroy();
      return false;
    });
    if (this.feedItems.length !== before) this.layoutFeed();
  }
}
