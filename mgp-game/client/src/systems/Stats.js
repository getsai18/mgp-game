import { GAME_WIDTH } from '../level.js';
import { PLAYER_COLORS } from '../skins.js';
import { session } from '../net.js';

const blank = () => ({ shots: 0, hits: 0, deaths: 0, falls: 0 });

// Estadísticas de la partida. Cada cliente las cuenta con lo que ya ve (sus disparos y aciertos,
// los 'player_shoot' y 'player_hit' del rival, y las muertes de ambos): no viajan por red.
export default class Stats {
  constructor(scene) {
    this.scene = scene;
    this.panel = [];
    this.reset();
  }

  reset() {
    this.s = { me: blank(), rival: blank() };
    this.hidePanel();
  }

  shot(who) { this.s[who].shots++; }
  hit(who) { this.s[who].hits++; }
  death(who, environmental) {
    this.s[who].deaths++;
    if (environmental) this.s[who].falls++;
  }

  showPanel(winnerIndex, score, nameOf) {
    this.hidePanel();
    const s = this.scene;
    const ui = (obj) => (this.panel.push(obj), s.juice.ui(obj));
    const cx = GAME_WIDTH / 2;
    const top = 250;
    ui(s.add.rectangle(cx, top + 95, 520, 220, 0x0b0b14, 0.88).setStrokeStyle(2, 0xffffff, 0.3).setDepth(150));
    ui(s.add.text(cx, top, 'ESTADÍSTICAS', { fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: '#ffd27a' }).setOrigin(0.5).setDepth(151));

    const me = session.playerIndex;
    const byIndex = [];
    byIndex[me] = this.s.me;
    byIndex[1 - me] = this.s.rival;
    const acc = (p) => (p.shots ? `${Math.min(100, Math.round((p.hits / p.shots) * 100))}%` : '-');
    const rows = [
      ['RONDAS', (i) => score[i]],
      ['DISPAROS', (i) => byIndex[i].shots],
      ['PRECISIÓN', (i) => acc(byIndex[i])],
      ['MUERTES', (i) => byIndex[i].deaths],
      ['CAÍDAS', (i) => byIndex[i].falls],
    ];
    const colX = [cx + 30, cx + 170];
    [0, 1].forEach((i) => {
      const color = `#${PLAYER_COLORS[i].toString(16)}`;
      ui(s.add.text(colX[i], top + 30, nameOf(i), { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color }).setOrigin(0.5).setDepth(151));
      if (i === winnerIndex) {
        ui(s.add.text(colX[i], top + 186, '★ MVP ★', { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#ffd27a' }).setOrigin(0.5).setDepth(151));
      }
    });
    rows.forEach(([label, value], k) => {
      const y = top + 58 + k * 24;
      ui(s.add.text(cx - 210, y, label, { fontFamily: 'monospace', fontSize: '13px', color: '#aab0c8' }).setOrigin(0, 0.5).setDepth(151));
      [0, 1].forEach((i) => ui(s.add.text(colX[i], y, String(value(i)), { fontFamily: 'monospace', fontSize: '15px', color: '#ffffff' }).setOrigin(0.5).setDepth(151)));
    });
    this.panel.forEach((o) => o.setAlpha(0));
    s.tweens.add({ targets: this.panel, alpha: 1, duration: 250 });
  }

  hidePanel() {
    for (const o of this.panel) o.destroy();
    this.panel = [];
  }
}
