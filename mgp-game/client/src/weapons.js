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

// Arma lanzada (E sin nada cerca): vuela girando y golpea. Por red viaja como arma 8 en 'player_hit'
// (fuera del rango 1-7 de las armas que caben en 'player_move', para no chocar con armas nuevas).
export const THROW = { speed: 560, lift: 220, damage: 1, knockback: 300, lifeMs: 1500, harmfulSpeed: 260 };
export const THROWN_WEAPON = 8;
export const weaponName = (w) => (w === THROWN_WEAPON ? 'ARMA LANZADA' : WEAPONS[w]?.name ?? '???');

export function randomWeaponType() {
  const entries = Object.entries(WEAPONS);
  let roll = Math.random() * entries.reduce((sum, [, w]) => sum + w.weight, 0);
  for (const [type, w] of entries) {
    roll -= w.weight;
    if (roll <= 0) return Number(type);
  }
  return 1;
}

// Daño de una explosión según la distancia al centro: 2 (mata) en el núcleo, 1 en el resto del radio.
export function explosionDamage(dist) {
  if (dist > EXPLOSION.radius) return 0;
  return dist <= EXPLOSION.radius * EXPLOSION.coreRatio ? 2 : 1;
}

// Empuje de una explosión sobre un cuerpo a `dist` px: lineal de force (centro) a minForce (borde),
// siempre con algo hacia arriba para que salga volando. (nx, ny) = dirección centro -> cuerpo.
export function blastImpulse(nx, ny, dist) {
  const force = EXPLOSION.minForce + (EXPLOSION.force - EXPLOSION.minForce) * (1 - dist / EXPLOSION.radius);
  return [nx * force, Math.min(ny, -0.35) * force];
}

// Daño máximo que puede traer un solo aviso de impacto con el arma `w` (lo valida el servidor).
export function maxHitDamage(w) {
  if (w === THROWN_WEAPON) return THROW.damage;
  const def = WEAPONS[w];
  if (!def) return 0;
  return def.explosive ? 2 : def.damage;
}

// Alcance máximo creíble de un disparo (px): lo que vuela la bala en su vida, más la onda expansiva.
export function weaponRange(w) {
  if (w === THROWN_WEAPON) return (THROW.speed * THROW.lifeMs) / 1000;
  const def = WEAPONS[w];
  return def ? (def.speed * def.life) / 1000 * 1.2 + (def.explosive ? EXPLOSION.radius : 0) : 0;
}
