import { describe, it, expect } from 'vitest';
import { packState, unpackState, interpolate, SNAP_DISTANCE, MAX_EXTRAPOLATE_MS } from '../../client/src/netState.js';

const player = { x: 100.4, y: 200.6, flipX: true, alive: true, pose: 'run2', hp: 2, body: { velocity: { x: 280, y: -40 } } };

describe('Estado de red e interpolación de posiciones', () => {
  it('empaqueta y desempaqueta el estado sin perder información', () => {
    const packed = packState(player, 3, true);
    expect(packed).toHaveLength(5);
    expect(unpackState(packed)).toMatchObject({ x: 100, y: 201, vx: 280, vy: -40, flip: true, alive: true, pose: 'run2', weaponType: 3, aimDown: true, hp: 2 });
  });

  it('interpola linealmente entre dos estados', () => {
    const a = { t: 0, x: 0, y: 0, vx: 0, vy: 0, alive: true };
    const b = { t: 100, x: 100, y: 50, vx: 0, vy: 0, alive: true };
    const r = interpolate(a, b, 25);
    expect(r.x).toBeCloseTo(25);
    expect(r.y).toBeCloseTo(12.5);
  });

  it('no interpola teletransportes (reaparición) ni cambios de vivo/muerto', () => {
    const a = { t: 0, x: 0, y: 0, vx: 0, vy: 0, alive: true };
    expect(interpolate(a, { ...a, t: 100, x: SNAP_DISTANCE + 50 }, 50).x).toBe(0);
    expect(interpolate(a, { ...a, t: 100, x: 40, alive: false }, 50).x).toBe(0);
  });

  it('sin estados nuevos extrapola con la velocidad, como mucho MAX_EXTRAPOLATE_MS', () => {
    const a = { t: 0, x: 0, y: 0, vx: 1000, vy: 0, alive: true };
    expect(interpolate(a, undefined, 50).x).toBeCloseTo(50);
    expect(interpolate(a, undefined, 5000).x).toBeCloseTo(MAX_EXTRAPOLATE_MS);
  });
});
