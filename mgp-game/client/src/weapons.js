// Definición de armas. La clave numérica (1-3) es lo que viaja por red.
//   recoil:     impulso horizontal opuesto al disparo
//   recoilHop:  pequeño salto extra si se dispara desde el suelo
//   recoilDown: impulso hacia arriba al disparar apuntando abajo (S/↓)
//   damage / knockback: por bala (cada perdigón cuenta: escopeta a quemarropa = muerte)
export const WEAPONS = {
  1: {
    key: 'pistol', name: 'PISTOLA', weight: 40,
    ammo: 10, cooldown: 170, speed: 950, pellets: 1, spread: 2, life: 900,
    recoil: 90, recoilHop: 0, recoilDown: 260,
    damage: 1, knockback: 220,
    bullet: 'bullet', shake: [40, 0.002],
  },
  2: {
    key: 'shotgun', name: 'ESCOPETA', weight: 35,
    ammo: 4, cooldown: 750, speed: 820, pellets: 7, spread: 14, life: 280,
    recoil: 560, recoilHop: 160, recoilDown: 720,
    damage: 1, knockback: 170,
    bullet: 'pellet', shake: [100, 0.01],
  },
  3: {
    key: 'rocket', name: 'LANZACOHETES', weight: 25,
    ammo: 2, cooldown: 1100, speed: 520, pellets: 1, spread: 0, life: 2500,
    recoil: 300, recoilHop: 120, recoilDown: 420,
    damage: 0, knockback: 0, // el daño lo hace la explosión
    bullet: 'rocket_proj', shake: [120, 0.012], explosive: true,
  },
};

export const EXPLOSION = {
  radius: 95,
  force: 900, // empuje en el centro; cae linealmente hasta el borde del radio
  minForce: 250,
  // Daño al rival: 2 (mata) dentro del núcleo, 1 en el resto del radio. Sin daño propio: el salto con cohete sale gratis.
  coreRatio: 0.55,
};

export const MAX_HP = 2;

export function randomWeaponType() {
  const entries = Object.entries(WEAPONS);
  let roll = Math.random() * entries.reduce((sum, [, w]) => sum + w.weight, 0);
  for (const [type, w] of entries) {
    roll -= w.weight;
    if (roll <= 0) return Number(type);
  }
  return 1;
}
