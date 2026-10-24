import { describe, it, expect } from 'vitest';
import { WEAPONS, EXPLOSION, THROWN_WEAPON, explosionDamage, blastImpulse, maxHitDamage, weaponRange, randomWeaponType } from '../../client/src/weapons.js';

describe('Fórmulas de daño y escalado', () => {
  it('la explosión mata en el núcleo, hiere en el borde y no daña fuera del radio', () => {
    expect(explosionDamage(0)).toBe(2);
    expect(explosionDamage(EXPLOSION.radius * EXPLOSION.coreRatio)).toBe(2);
    expect(explosionDamage(EXPLOSION.radius * 0.9)).toBe(1);
    expect(explosionDamage(EXPLOSION.radius + 1)).toBe(0);
  });

  it('el empuje escala de force (centro) a minForce (borde) y siempre lanza hacia arriba', () => {
    const [cx, cy] = blastImpulse(1, 0, 0);
    const [ex] = blastImpulse(1, 0, EXPLOSION.radius);
    expect(cx).toBeCloseTo(EXPLOSION.force);
    expect(ex).toBeCloseTo(EXPLOSION.minForce);
    expect(cy).toBeLessThan(0); // aunque la explosión venga de lado, sube
    expect(blastImpulse(0, 1, 10)[1]).toBeLessThan(0); // incluso desde arriba
  });

  it('cada arma declara un daño máximo y un alcance coherentes', () => {
    expect(maxHitDamage(1)).toBe(1);
    expect(maxHitDamage(3)).toBe(2); // cohete: daño de explosión
    expect(maxHitDamage(THROWN_WEAPON)).toBe(1);
    expect(maxHitDamage(99)).toBe(0);
    expect(weaponRange(1)).toBeGreaterThan(weaponRange(2)); // la pistola llega más lejos que la escopeta
    expect(weaponRange(3)).toBeGreaterThan(WEAPONS[3].speed * WEAPONS[3].life / 1000);
  });

  it('la aparición aleatoria solo da armas existentes y respeta los pesos', () => {
    const count = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 3000; i++) count[randomWeaponType()]++;
    expect(Object.keys(count).every((k) => WEAPONS[k])).toBe(true);
    expect(count[1]).toBeGreaterThan(count[3]); // pistola (40) más común que cohete (25)
  });
});
