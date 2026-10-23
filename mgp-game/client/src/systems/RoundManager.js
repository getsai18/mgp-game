import { GAME_WIDTH } from '../level.js';
import { PLAYER_COLORS } from '../entities/Player.js';
import { MAPS, mapForRound } from '../maps.js';
import { socket, session } from '../net.js';

const WINS_TO_MATCH = 5;
const DRAW_WINDOW_MS = 250; // dos muertes dentro de esta ventana = empate
const NEXT_ROUND_MS = 2200;
const NEXT_MATCH_MS = 4000;
const SOLO_RESPAWN_MS = 1200;
const NAMES = ['AZUL', 'ROJO'];

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// Rondas 1vs1 con el host como árbitro (el servidor sigue sin lógica).
//   invitado -> host:  round_end { r, loser }                  "he muerto en la ronda r"
//   host -> invitado:  round_end { r, winner, score, match }    veredicto (winner -1 = empate)
// Fases: 'solo' (sin rival, reaparición libre), 'playing', 'ended' (entre rondas).
export default class RoundManager {
  constructor(scene) {
    this.scene = scene;
    this.phase = session.opponent ? 'playing' : 'solo';
    this.round = 1;
    this.score = [0, 0];
    this.deaths = new Set();
    this.decideTimer = null;
    this.nextTimer = null;

    this.createUi();
    this.bindNet();
    if (session.opponent) this.startMatch();
  }

  createUi() {
    const s = this.scene;
    this.scoreText = s.juice.ui(s.add
      .text(GAME_WIDTH / 2, 34, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5, 0).setDepth(100));
    this.banner = s.juice.ui(s.add
      .text(GAME_WIDTH / 2, 170, '', {
        fontFamily: 'monospace', fontSize: '42px', color: '#ffffff', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 6, align: 'center',
      })
      .setOrigin(0.5).setDepth(101).setVisible(false));
    this.renderScore();
  }

  bindNet() {
    const handlers = {
      match_start: () => this.startMatch(),
      opponent_left: () => this.toSolo(),
      joined: () => this.toSolo(),
      round_end: (d) => this.onRoundEnd(d),
    };
    for (const [evt, fn] of Object.entries(handlers)) socket.on(evt, fn);
    this.scene.events.once('shutdown', () => Object.entries(handlers).forEach(([evt, fn]) => socket.off(evt, fn)));
  }

  canDealDamage() {
    return this.phase === 'playing';
  }

  // ------------------------------------------------------------------ flujo
  startMatch() {
    this.cancelTimers();
    this.score = [0, 0];
    this.round = 1;
    this.startRound();
  }

  toSolo() {
    this.cancelTimers();
    this.phase = 'solo';
    this.score = [0, 0];
    this.round = 1;
    this.banner.setVisible(false);
    this.renderScore();
    if (!this.scene.player.alive) this.scene.resetRound();
  }

  startRound() {
    this.phase = 'playing';
    this.deaths.clear();
    this.decideTimer = null;
    const mapIndex = mapForRound(this.round);
    this.scene.resetRound(mapIndex);
    this.renderScore();
    this.showBanner(`RONDA ${this.round}\n${MAPS[mapIndex].name}`, '#ffffff', 1000);
  }

  onLocalDeath() {
    if (this.phase === 'solo') {
      this.nextTimer = this.scene.time.delayedCall(SOLO_RESPAWN_MS, () => this.scene.player.respawn());
    } else if (this.phase === 'playing') {
      if (session.isHost) this.registerDeath(session.playerIndex);
      else socket.emit('round_end', { r: this.round, loser: session.playerIndex });
    }
    // 'ended': ya hay veredicto; reaparecerá al empezar la siguiente ronda.
  }

  onRoundEnd(d) {
    if (!d || d.r !== this.round) return;
    if (session.isHost) {
      // Aviso de muerte del invitado.
      if (this.phase === 'playing' && (d.loser === 0 || d.loser === 1)) this.registerDeath(d.loser);
    } else if (Array.isArray(d.score)) {
      this.applyVerdict(d);
    }
  }

  // Solo host: espera un poco por si es empate y emite el veredicto.
  registerDeath(index) {
    this.deaths.add(index);
    if (this.decideTimer) return;
    this.decideTimer = this.scene.time.delayedCall(DRAW_WINDOW_MS, () => {
      const winner = this.deaths.size >= 2 ? -1 : 1 - [...this.deaths][0];
      const score = [...this.score];
      if (winner >= 0) score[winner]++;
      const match = winner >= 0 && score[winner] >= WINS_TO_MATCH ? winner : -1;
      const verdict = { r: this.round, winner, score, match };
      socket.emit('round_end', verdict);
      this.applyVerdict(verdict);
    });
  }

  applyVerdict({ r, winner, score, match }) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.score = score.map((n) => Number(n) || 0);
    this.renderScore();

    if (match >= 0) {
      this.showBanner(`¡${NAMES[match]} GANA\nLA PARTIDA!`, hex(PLAYER_COLORS[match]), NEXT_MATCH_MS - 300);
      this.scene.cameras.main.flash(300, 255, 255, 255);
    } else if (winner >= 0) {
      this.showBanner(`¡${NAMES[winner]} GANA\nLA RONDA!`, hex(PLAYER_COLORS[winner]), NEXT_ROUND_MS - 300);
    } else {
      this.showBanner('¡EMPATE!', '#ffffff', NEXT_ROUND_MS - 300);
    }

    this.nextTimer = this.scene.time.delayedCall(match >= 0 ? NEXT_MATCH_MS : NEXT_ROUND_MS, () => {
      // Partida nueva: marcador a cero. El número de ronda solo vuelve a 1 en ambos a la vez,
      // porque los dos aplican el mismo veredicto.
      if (match >= 0) this.score = [0, 0];
      this.round = match >= 0 ? 1 : r + 1;
      this.startRound();
    });
  }

  cancelTimers() {
    this.decideTimer?.remove();
    this.nextTimer?.remove();
    this.decideTimer = null;
    this.nextTimer = null;
  }

  // --------------------------------------------------------------------- UI
  renderScore() {
    if (this.phase === 'solo') return this.scoreText.setText('PRÁCTICA');
    this.scoreText.setText(`${NAMES[0]} ${this.score[0]}  -  ${this.score[1]} ${NAMES[1]}   ·  R${this.round}  ·  a ${WINS_TO_MATCH}`);
  }

  showBanner(text, color, ms) {
    const b = this.banner;
    this.scene.tweens.killTweensOf(b);
    b.setText(text).setColor(color).setVisible(true).setScale(0.3).setAlpha(1);
    this.scene.tweens.add({ targets: b, scale: 1, duration: 280, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: b, alpha: 0, delay: ms, duration: 250, onComplete: () => b.setVisible(false) });
  }
}
