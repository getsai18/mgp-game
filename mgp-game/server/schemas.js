import { z } from 'zod';

// Esquemas Zod de todo lo que entra al servidor (eventos de socket y peticiones REST).
// Un payload que no cumple se descarta: el cliente no puede mandar basura ni valores fuera de rango.

const int = (min, max) => z.number().int().min(min).max(max);
const num = (min, max) => z.number().finite().min(min).max(max);

// [x, y, vx, vy, flags] (ver client/src/netState.js). Límites: el mundo mide 1440x816 y se puede
// salir un poco por arriba (salto con cohete) o caer por debajo (al morir).
export const moveSchema = z.tuple([int(-200, 1640), int(-3000, 3000), int(-3000, 3000), int(-3000, 3000), int(0, 2047)]);

export const shootSchema = z.object({
  w: int(1, 7),
  x: num(-200, 1640),
  y: num(-3000, 3000),
  a: z.array(int(-720, 720)).min(1).max(7),
});

export const spawnSchema = z.object({
  id: z.string().min(1).max(24),
  t: int(1, 7),
  x: num(0, 1440),
  y: num(-100, 900),
  p: int(-1, 63).optional(),
});

export const pickupSchema = z.object({ id: z.string().min(1).max(24) });

export const throwSchema = z.object({
  w: int(1, 7),
  x: num(-200, 1640),
  y: num(-3000, 3000),
  vx: num(-2000, 2000),
  vy: num(-2000, 2000),
});

// Aviso de impacto del que disparó (el servidor decide si se lo cree).
export const hitSchema = z.object({
  d: int(0, 2),
  kx: num(-800, 800),
  ky: num(-800, 800),
  w: int(1, 8),
});

// Aviso de muerte propia (caída, pinchos o golpe).
export const deathSchema = z.object({ r: int(1, 10000), loser: int(0, 1) });

export const infoSchema = z.object({ name: z.string().trim().min(1).max(12) });
export const tauntSchema = z.object({ i: int(0, 31) });
export const pingSchema = z.object({ t: z.number().finite(), rtt: num(0, 60000).optional() });

// Salas privadas: código de 3-8 letras/números y contraseña opcional.
export const roomSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,8}$/, 'El código debe tener de 3 a 8 letras o números'),
  password: z.string().max(32).optional().default(''),
  name: z.string().trim().max(12).optional().default('Soldado'),
});
export const readySchema = z.object({ ready: z.boolean() });

// POST /api/test/seed: genera `count` partidas aleatorias o inserta las que vengan en `matches`.
const seedPlayerSchema = z.object({
  name: z.string().min(1).max(12),
  kills: int(0, 100),
  deaths: int(0, 100),
  won: z.boolean(),
  survivalMs: num(0, 3_600_000),
});
export const matchSchema = z.object({
  players: z.tuple([seedPlayerSchema, seedPlayerSchema]),
  rounds: int(1, 100),
  durationMs: num(0, 36_000_000),
  at: z.number().int().positive().optional(),
});
export const seedSchema = z.union([
  z.object({ count: int(100, 1000), reset: z.boolean().optional(), seed: z.number().int().optional() }).strict(),
  z.object({ matches: z.array(matchSchema).min(100).max(1000), reset: z.boolean().optional() }).strict(),
]);

// Valida y devuelve el dato limpio, o null si no cumple.
export function parse(schema, data) {
  const r = schema.safeParse(data);
  return r.success ? r.data : null;
}
