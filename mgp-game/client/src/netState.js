import { POSES, SKIN_H, BODY_OFFSET } from './skins.js';

// Estado del jugador que viaja por red y su interpolación. Sin Phaser: lo usan RemotePlayer,
// el servidor (validación) y las pruebas unitarias.
//
// Formato de 'player_move' (array para que pese ~25 bytes):
//   [x, y, vx, vy, flags]
//   flags: bit0 = flipX, bit1 = vivo, bits2-4 = pose, bits5-7 = arma (0 = ninguna, hasta 7 tipos),
//          bit8 = apunta abajo, bits9-10 = vida
const POSE_INDEX = Object.fromEntries(POSES.map((key, i) => [key, i]));

// Del centro del sprite a los pies (borde inferior del cuerpo físico) con escala 1.
export const FEET_Y = BODY_OFFSET.y + 36 - SKIN_H / 2;

export const SNAP_DISTANCE = 150; // saltos mayores (reaparición) no se interpolan
export const MAX_EXTRAPOLATE_MS = 120; // si se corta el flujo, seguir con la última velocidad un poco

export function packState(player, weaponType = 0, aimDown = false) {
  const flags =
    (player.flipX ? 1 : 0) |
    (player.alive ? 2 : 0) |
    ((POSE_INDEX[player.pose] ?? 0) << 2) |
    ((weaponType & 7) << 5) |
    (aimDown ? 256 : 0) |
    ((player.hp & 3) << 9);
  // Posición del CUERPO FÍSICO, no del sprite: el sprite se sincroniza después y puede ir un paso de
  // física por detrás, y al estirarse/aplastarse cambia su centro. Anclada a los pies: el servidor
  // (server/arbiter.js) y el rival ven exactamente dónde pisa.
  const body = player.body;
  const x = body.center?.x ?? player.x;
  const y = body.bottom !== undefined ? body.bottom - FEET_Y : player.y;
  const { x: vx, y: vy } = body.velocity;
  return [Math.round(x), Math.round(y), Math.round(vx), Math.round(vy), flags];
}

export function unpackState([x, y, vx, vy, flags]) {
  return {
    x, y, vx, vy,
    flip: !!(flags & 1),
    alive: !!(flags & 2),
    pose: POSES[(flags >> 2) & 7] ?? POSES[0],
    weaponType: (flags >> 5) & 7,
    aimDown: !!(flags & 256),
    hp: (flags >> 9) & 3,
  };
}

// Posición a dibujar en renderT a partir de los dos estados que lo rodean (a.t <= renderT < b.t);
// sin estado futuro, extrapola un poco con la última velocidad. Devuelve { x, y, ref }.
export function interpolate(a, b, renderT) {
  if (b && renderT >= a.t && renderT < b.t) {
    const teleport = a.alive !== b.alive || Math.hypot(b.x - a.x, b.y - a.y) > SNAP_DISTANCE;
    const k = teleport ? 0 : (renderT - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ref: a };
  }
  const ref = b && renderT >= b.t ? b : a;
  const dt = Math.min(Math.max(renderT - ref.t, 0), MAX_EXTRAPOLATE_MS) / 1000;
  return { x: ref.x + ref.vx * dt, y: ref.y + ref.vy * dt, ref };
}
