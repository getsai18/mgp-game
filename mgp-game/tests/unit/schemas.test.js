import { describe, it, expect } from 'vitest';
import { moveSchema, hitSchema, roomSchema, seedSchema, shootSchema, parse } from '../../server/schemas.js';

describe('Esquemas Zod de payload', () => {
  it('acepta un movimiento válido [x, y, vx, vy, flags]', () => {
    expect(parse(moveSchema, [720, 400, 120, -300, 6])).toEqual([720, 400, 120, -300, 6]);
  });

  it('rechaza movimientos mal formados o fuera del mundo', () => {
    expect(parse(moveSchema, ['720', 400, 0, 0, 2])).toBeNull(); // texto
    expect(parse(moveSchema, [NaN, 400, 0, 0, 2])).toBeNull();
    expect(parse(moveSchema, [720, 400, 0, 0])).toBeNull(); // le falta un campo
    expect(parse(moveSchema, [99999, 400, 0, 0, 2])).toBeNull(); // fuera del mapa
    expect(parse(moveSchema, [720.5, 400, 0, 0, 2])).toBeNull(); // no entero
  });

  it('limita el daño y las balas que puede declarar un cliente', () => {
    expect(parse(hitSchema, { kx: 100, ky: -80, w: 1 })).not.toBeNull();
    expect(parse(hitSchema, { kx: 0, ky: 0, w: 3, ex: 400, ey: 300 })).not.toBeNull();
    expect(parse(hitSchema, { d: 2, kx: 0, ky: 0, w: 1 })).toBeNull(); // el cliente no declara daño
    expect(parse(hitSchema, { kx: 5000, ky: 0, w: 1 })).toBeNull();
    expect(parse(shootSchema, { w: 2, x: 10, y: 10, a: new Array(30).fill(0) })).toBeNull(); // 30 perdigones
  });

  it('normaliza el código de sala y rechaza códigos inválidos', () => {
    expect(parse(roomSchema, { code: ' abc12 ', password: 'x' })).toMatchObject({ code: 'ABC12', password: 'x' });
    expect(parse(roomSchema, { code: 'a' })).toBeNull();
    expect(parse(roomSchema, { code: 'ab-cd' })).toBeNull();
  });

  it('el seed acepta de 100 a 1000 partidas y nada fuera de ese rango', () => {
    expect(parse(seedSchema, { count: 100 })).not.toBeNull();
    expect(parse(seedSchema, { count: 1000, seed: 7, reset: true })).not.toBeNull();
    expect(parse(seedSchema, { count: 50 })).toBeNull();
    expect(parse(seedSchema, { count: 2000 })).toBeNull();
    expect(parse(seedSchema, { foo: 1 })).toBeNull();
  });
});
