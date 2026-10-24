import { describe, it, expect, beforeEach } from 'vitest';
import GameRoom from '../../server/game.js';
import Telemetry from '../../server/telemetry.js';
import { WEAPONS, MAX_HP } from '../../client/src/weapons.js';
import { DRAW_WINDOW_MS, WINS_TO_MATCH } from '../../client/src/rules.js';

// Reloj y temporizadores falsos: el test controla el tiempo.
function fakeClock() {
  const c = { t: 1000, timers: [] };
  c.now = () => c.t;
  c.setTimer = (fn, ms) => {
    const timer = { at: c.t + ms, fn };
    c.timers.push(timer);
    return timer;
  };
  c.clearTimer = (timer) => (c.timers = c.timers.filter((x) => x !== timer));
  c.advance = (ms) => {
    c.t += ms;
    for (const timer of c.timers.filter((x) => x.at <= c.t)) {
      c.timers = c.timers.filter((x) => x !== timer);
      timer.fn();
    }
  };
  return c;
}

let clock, room, sent, telemetry;
beforeEach(() => {
  clock = fakeClock();
  sent = [];
  telemetry = new Telemetry();
  room = new GameRoom({ id: 'r', telemetry, send: () => {}, broadcast: (evt, data) => sent.push([evt, data]), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  room.addPlayer('a', 'ANA');
  room.addPlayer('b', 'BETO');
  room.startMatch();
});

const giveWeapon = (id, type) => {
  clock.advance(1000);
  room.onSpawn('a', { id: `w${type}${clock.t}`, t: type, x: 100, y: 100 });
  room.onPickup(id, { id: `w${type}${clock.t}` });
};

describe('Autoridad del servidor (GameRoom)', () => {
  it('no se puede disparar sin arma, sin munición ni más rápido que la cadencia', () => {
    expect(room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] })).toBe(false); // sin arma
    giveWeapon('a', 1);
    expect(room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] })).toBe(true);
    expect(room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] })).toBe(false); // demasiado rápido
    for (let i = 1; i < WEAPONS[1].ammo; i++) {
      clock.advance(WEAPONS[1].cooldown);
      expect(room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] })).toBe(true);
    }
    clock.advance(1000);
    expect(room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] })).toBe(false); // sin balas
  });

  it('cada arma del suelo solo la recoge uno (el primero) y solo el host las hace aparecer', () => {
    clock.advance(1000);
    expect(room.onSpawn('b', { id: 'x1', t: 2, x: 10, y: 10 })).toBe(false); // b no es host
    expect(room.onSpawn('a', { id: 'x1', t: 2, x: 10, y: 10 })).toBe(true);
    expect(room.onPickup('b', { id: 'x1' })).toBe(true);
    expect(room.onPickup('a', { id: 'x1' })).toBe(false);
    expect(room.player('b').weapon.type).toBe(2);
  });

  it('rechaza impactos sin disparo previo y resta la vida de los válidos', () => {
    expect(room.onHit('a', { d: 1, kx: 0, ky: 0, w: 1 })).toBeNull(); // nunca disparó
    giveWeapon('a', 1);
    room.onShoot('a', { w: 1, x: 0, y: 0, a: [0] });
    expect(room.onHit('a', { d: 2, kx: 0, ky: 0, w: 1 })).toBeNull(); // la pistola no quita 2
    expect(room.onHit('a', { d: 1, kx: 0, ky: 0, w: 1 })).not.toBeNull();
    expect(room.player('b').hp).toBe(MAX_HP - 1);
    expect(room.onHit('a', { d: 1, kx: 0, ky: 0, w: 1 })).toBeNull(); // una bala = un impacto
  });

  it('rechaza teletransportes y acepta movimiento normal', () => {
    clock.advance(1000);
    expect(room.onMove('a', [100, 100, 0, 0, 2])).toBe(true);
    clock.advance(50);
    expect(room.onMove('a', [114, 100, 280, 0, 2])).toBe(true);
    clock.advance(50);
    expect(room.onMove('a', [1300, 100, 0, 0, 2])).toBe(false); // 1186 px en 50 ms
  });

  it('una muerte da la ronda al rival; dos casi a la vez son empate; a 5 se gana la partida', () => {
    room.onDeathReport('b', { r: 1, loser: 1 });
    clock.advance(DRAW_WINDOW_MS);
    expect(sent.at(-1)).toEqual(['round_end', { r: 1, winner: 0, score: [1, 0], match: -1 }]);
    clock.advance(10000); // siguiente ronda
    room.onDeathReport('a', { r: 2, loser: 0 });
    room.onDeathReport('b', { r: 2, loser: 1 });
    clock.advance(DRAW_WINDOW_MS);
    expect(sent.at(-1)[1]).toMatchObject({ winner: -1, score: [1, 0] });
    for (let r = 3; room.score[0] < WINS_TO_MATCH; r++) {
      clock.advance(10000);
      room.onDeathReport('b', { r, loser: 1 });
      clock.advance(DRAW_WINDOW_MS);
    }
    expect(sent.at(-1)[1].match).toBe(0);
    expect(telemetry.summary().matches).toBe(1); // la partida queda en la telemetría
  });
});

describe('Telemetría', () => {
  it('siembra partidas y calcula win rate, KDR y supervivencia rápido', () => {
    const t = new Telemetry();
    t.seed(1000, 42);
    const s = t.summary();
    expect(s.matches).toBe(1000);
    expect(s.winRate.player1 + s.winRate.player2).toBeCloseTo(1);
    expect(s.kdr).toBeGreaterThan(0);
    expect(s.avgSurvivalMs).toBeGreaterThan(0);
    expect(s.topPlayers.length).toBeGreaterThan(0);
    expect(s.computedInMs).toBeLessThan(50);
  });
});
