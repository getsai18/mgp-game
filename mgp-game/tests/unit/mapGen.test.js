import { describe, it, expect } from 'vitest';
import { MAPS } from '../../client/src/maps.js';
import { generateMap, roundMap, mixSeed } from '../../client/src/mapGen.js';
import NavGraph from '../../client/src/systems/NavGraph.js';

const mirrored = (row) => [...row].reverse().map((ch) => (ch === 'A' ? 'B' : ch === 'B' ? 'A' : ch)).join('');

describe('Generador procedural de mapas (mapGen)', () => {
  it('misma semilla, mismo mapa; semillas distintas, mapas distintos', () => {
    expect(generateMap(1234, 0).rows).toEqual(generateMap(1234, 0).rows);
    expect(generateMap(1234, 0).rows).not.toEqual(generateMap(9876, 0).rows);
  });

  it('genera mapas de 90x51, simétricos y con apariciones y armas, en todos los estilos', () => {
    for (let theme = 0; theme < MAPS.length; theme++) {
      for (let s = 1; s <= 8; s++) {
        const m = generateMap(mixSeed(s, theme), theme);
        expect(m.generated).toBe(true);
        expect(m.rows).toHaveLength(51);
        for (const row of m.rows) {
          expect(row).toHaveLength(90);
          // simétrico salvo el arma del centro ('c', solo a la izquierda del eje)
          expect(row.replace('c', '.')).toBe(mirrored(row).replace('c', '.'));
        }
        expect(m.spawns[0].x + m.spawns[1].x).toBe(m.width); // A y B reflejados
        expect(m.weaponSpawns.length).toBeGreaterThanOrEqual(3);
        expect(m.theme.style).toBe(MAPS[theme].theme.style);
      }
    }
  });

  it('todo mapa generado es jugable: se llega al rival y a todas las armas, sin zonas trampa', () => {
    for (let s = 0; s < 30; s++) {
      const m = generateMap(mixSeed(77, s), s % MAPS.length);
      const nav = NavGraph.for(m);
      const seg = (p, feet) => nav.standingSeg(p.x, p.y + feet);
      const reach = nav.reachable(seg(m.spawns[0], 20));
      expect(reach.has(seg(m.spawns[1], 20))).toBe(true);
      for (const w of m.weaponSpawns) expect(reach.has(seg(w, 8))).toBe(true);
      expect(nav.segs.some((x) => x.trap)).toBe(false);
    }
  });

  it('las rondas alternan mapas a mano y procedurales, iguales para quien tenga la misma semilla', () => {
    expect(roundMap(1, 42)).toBe(MAPS[0]);
    expect(roundMap(3, 42)).toBe(MAPS[1]);
    expect(roundMap(2, 42).generated).toBe(true);
    expect(roundMap(2, 42).rows).toEqual(roundMap(2, 42).rows); // servidor y clientes
    expect(roundMap(2, 42, 1).rows).not.toEqual(roundMap(2, 42, 0).rows); // revancha: mapas nuevos
    expect(roundMap(2, null)).toBe(MAPS[0]); // sin semilla, solo a mano
  });
});
