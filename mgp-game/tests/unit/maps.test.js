import { describe, it, expect } from 'vitest';
import { MAPS, parse, mapForRound } from '../../client/src/maps.js';
import NavGraph from '../../client/src/systems/NavGraph.js';
import { TILE } from '../../client/src/level.js';

describe('Generador de mapas (ASCII -> geometría)', () => {
  it('los 6 mapas miden 90x51 y tienen apariciones A/B y puntos de arma', () => {
    expect(MAPS).toHaveLength(6);
    for (const m of MAPS) {
      expect(m.rows).toHaveLength(51);
      expect(m.rows.every((r) => r.length === 90)).toBe(true);
      expect(m.spawns[0]).toBeDefined();
      expect(m.spawns[1]).toBeDefined();
      expect(m.weaponSpawns.length).toBeGreaterThan(2);
      expect(m.width).toBe(1440);
    }
  });

  it('los rectángulos fusionados cubren exactamente las casillas sólidas, sin solaparse', () => {
    for (const m of MAPS) {
      const solidTiles = m.rows.join('').split('').filter((c) => c === '#' || c === '%').length;
      const area = m.solids.reduce((sum, r) => sum + (r.w / TILE) * (r.h / TILE), 0);
      expect(area).toBe(solidTiles);
      expect(m.solids.length).toBeLessThan(solidTiles); // de verdad fusiona
    }
  });

  it('interpreta plataformas, pinchos y la zona de muerte por defecto', () => {
    const m = parse({ name: 'T', theme: { death: 'void' }, rows: ['..........', '.A..-..B..', '##########', '...^^.....', '##########'] });
    expect(m.oneWays).toEqual([{ x: 4 * TILE, y: TILE, w: TILE }]);
    expect(m.spikes[0]).toMatchObject({ x: 3 * TILE, w: 2 * TILE, h: TILE / 2 });
    expect(m.deathY).toBe(5 * TILE + 40);
    expect(mapForRound(7)).toBe(0); // rotan
  });

  it('el bot puede llegar a todas las armas y apariciones (sin zonas trampa)', () => {
    for (const m of MAPS) {
      const nav = new NavGraph(m);
      const segA = nav.standingSeg(m.spawns[0].x, m.spawns[0].y + 20);
      const reach = nav.reachable(segA, () => true);
      expect(reach.has(nav.standingSeg(m.spawns[1].x, m.spawns[1].y + 20))).toBe(true);
      for (const w of m.weaponSpawns) expect(reach.has(nav.standingSeg(w.x, w.y + 8))).toBe(true);
      expect(nav.segs.some((s) => s.trap)).toBe(false);
    }
  });
});
