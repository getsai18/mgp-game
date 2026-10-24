import { GAME_WIDTH } from '../level.js';
import { PLAYER_COLORS } from '../entities/Player.js';
import { roundMap } from '../mapGen.js';
import { prefetchMatchMaps } from '../mapPrefetch.js';
import { socket, session } from '../net.js';
import { play, setMusicIntensity } from '../audio.js';
import {
  WINS_TO_MATCH, DRAW_WINDOW_MS, BANNER_MS, REPLAY_AT_MS, REPLAY_FROM_AGO_MS, REPLAY_TO_AGO_MS, REPLAY_SPEED,
  REPLAY_END_MS, NEXT_ROUND_MS, NEXT_MATCH_MS,
} from '../rules.js';

const SOLO_RESPAWN_MS = 1200;
const NAMES = ['AZUL', 'ROJO']; // si alguien no tiene nombre

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// Rondas 1vs1. Online arbitra el SERVIDOR (server/game.js): él lleva la vida de cada uno, detecta
// las muertes (golpes, agua, vacío, pinchos) con su copia del mapa y emite el veredicto a los dos:
//   servidor -> ambos:    round_end { r, winner, score, match }    veredicto (winner -1 = empate)
// VS BOT (sin red) arbitra este mismo cliente con registerDeath().
// Fases: 'solo' (sin rival, reaparición libre), 'playing', 'ended' (entre rondas).
export default class RoundManager {
  constructor(scene) {
    this.scene = scene;
    this.phase = session.opponent ? 'playing' : 'solo';
    this.round = 1;
    this.matchNo = 0; // revanchas en la misma sala (cambian los mapas generados; ver mapGen.roundMap)
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
      player_info: () => this.renderScore(),
    };
    for (const [evt, fn] of Object.entries(handlers)) socket.on(evt, fn);
    this.scene.events.once('shutdown', () => Object.entries(handlers).forEach(([evt, fn]) => socket.off(evt, fn)));
  }

  nameOf(index) {
    const name = index === session.playerIndex ? session.name : session.opponentName;
    return (name || NAMES[index]).toUpperCase();
  }

  canDealDamage() {
    return this.phase === 'playing';
  }

  // ------------------------------------------------------------------ flujo
  startMatch() {
    this.cancelTimers();
    this.scene.stats?.reset();
    this.score = [0, 0];
    this.round = 1;
    this.matchNo = 0;
    prefetchMatchMaps(session.mapSeed, 0); // mapas procedurales de la partida, en otro hilo
    this.startRound();
  }

  toSolo() {
    this.cancelTimers();
    this.phase = 'solo';
    this.score = [0, 0];
    setMusicIntensity(false);
    this.round = 1;
    this.banner.setVisible(false);
    this.renderScore();
    if (!this.scene.player.alive) this.scene.resetRound();
  }

  startRound() {
    this.phase = 'playing';
    this.deaths.clear();
    this.decideTimer = null;
    // Mismo mapa que el rival y el servidor: ronda + semilla de la partida + número de revancha.
    const map = roundMap(this.round, session.mapSeed, this.matchNo);
    this.scene.resetRound(map);
    setMusicIntensity(this.score.some((n) => n === WINS_TO_MATCH - 1)); // punto de partido: más caña
    this.renderScore();
    this.showBanner(`RONDA ${this.round}\n${map.name}${map.generated ? '\nPROCEDURAL' : ''}`, '#ffffff', 1000);
    play('round');
  }

  onLocalDeath() {
    if (this.phase === 'solo') {
      this.nextTimer = this.scene.time.delayedCall(SOLO_RESPAWN_MS, () => this.scene.player.respawn());
    } else if (this.phase === 'playing') {
      // Online no se avisa nada: el servidor ve la muerte en nuestras posiciones y manda el veredicto.
      if (this.scene.mode !== 'online') this.registerDeath(session.playerIndex);
    }
    // 'ended': ya hay veredicto; reaparecerá al empezar la siguiente ronda.
  }

  // VS BOT: somos host y árbitro; la muerte del bot cuenta como la del rival.
  onBotDeath() {
    if (this.phase === 'playing') this.registerDeath(1 - session.playerIndex);
  }

  onRoundEnd(d) {
    // Solo veredictos del servidor (los avisos de muerte del rival ya no llegan: los procesa él).
    if (!d || d.r !== this.round || !Array.isArray(d.score)) return;
    this.applyVerdict(d);
  }

  // Solo VS BOT (online lo hace el servidor): espera un poco por si es empate y aplica el veredicto.
  registerDeath(index) {
    this.deaths.add(index);
    if (this.decideTimer) return;
    this.decideTimer = this.scene.time.delayedCall(DRAW_WINDOW_MS, () => {
      const winner = this.deaths.size >= 2 ? -1 : 1 - [...this.deaths][0];
      const score = [...this.score];
      if (winner >= 0) score[winner]++;
      const match = winner >= 0 && score[winner] >= WINS_TO_MATCH ? winner : -1;
      this.applyVerdict({ r: this.round, winner, score, match });
    });
  }

  applyVerdict({ r, winner, score, match }) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.score = score.map((n) => Number(n) || 0);
    this.renderScore();

    if (match >= 0) {
      this.showBanner(`¡${this.nameOf(match)} GANA\nLA PARTIDA!`, hex(PLAYER_COLORS[match]), BANNER_MS);
      this.scene.cameras.main.flash(300, 255, 255, 255);
    } else if (winner >= 0) {
      this.showBanner(`¡${this.nameOf(winner)} GANA\nLA RONDA!`, hex(PLAYER_COLORS[winner]), BANNER_MS);
    } else {
      this.showBanner('¡EMPATE!', '#ffffff', BANNER_MS);
    }
    this.replayTimer = this.scene.time.delayedCall(REPLAY_AT_MS, () => this.scene.replay.play(REPLAY_FROM_AGO_MS, REPLAY_TO_AGO_MS, REPLAY_SPEED));
    if (match >= 0) {
      this.championTimer = this.scene.time.delayedCall(REPLAY_END_MS + 50, () => {
        this.showBanner(`🏆 ${this.nameOf(match)}\nCAMPEÓN`, hex(PLAYER_COLORS[match]), NEXT_MATCH_MS - REPLAY_END_MS - 400);
        this.scene.onMatchEnd?.(match);
      });
    }

    if (winner >= 0) play('win');
    this.nextTimer = this.scene.time.delayedCall(match >= 0 ? NEXT_MATCH_MS : NEXT_ROUND_MS, () => {
      // Partida nueva: marcador a cero. El número de ronda solo vuelve a 1 en ambos a la vez,
      // porque los dos aplican el mismo veredicto.
      if (match >= 0) {
        this.score = [0, 0];
        this.matchNo++;
        prefetchMatchMaps(session.mapSeed, this.matchNo);
      }
      this.round = match >= 0 ? 1 : r + 1;
      this.startRound();
    });
  }

  cancelTimers() {
    for (const t of [this.decideTimer, this.nextTimer, this.replayTimer, this.championTimer]) t?.remove();
    this.decideTimer = this.nextTimer = this.replayTimer = this.championTimer = null;
    this.scene.replay?.stop();
  }

  // --------------------------------------------------------------------- UI
  renderScore() {
    if (this.phase === 'solo') return this.scoreText.setText('PRÁCTICA');
    this.scoreText.setText(`${this.nameOf(0)} ${this.score[0]}  -  ${this.score[1]} ${this.nameOf(1)}   ·  R${this.round}  ·  a ${WINS_TO_MATCH}`);
  }

  showBanner(text, color, ms) {
    const b = this.banner;
    this.scene.tweens.killTweensOf(b);
    b.setText(text).setColor(color).setVisible(true).setScale(0.3).setAlpha(1);
    this.scene.tweens.add({ targets: b, scale: 1, duration: 280, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: b, alpha: 0, delay: ms, duration: 250, onComplete: () => b.setVisible(false) });
  }
}
