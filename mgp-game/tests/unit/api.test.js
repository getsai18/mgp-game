import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../../server/app.js';

// Integración: servidor real en un puerto libre, peticiones HTTP y sockets de verdad.
let server, base;
beforeAll(async () => {
  server = createGameServer();
  const port = await server.listen(0);
  base = `http://127.0.0.1:${port}`;
});
afterAll(() => server.close());

const client = () => connect(base, { transports: ['websocket'], forceNew: true });
const emit = (s, evt, data) => new Promise((resolve) => s.emit(evt, data, resolve));

describe('API de pruebas /api/test/*', () => {
  it('GET /api/test/telemetry responde 200 en menos de 200 ms', async () => {
    const t0 = performance.now();
    const res = await fetch(`${base}/api/test/telemetry`);
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(200);
    expect(await res.json()).toHaveProperty('winRate');
  });

  it('POST /api/test/seed inyecta 1000 partidas y la consulta sigue por debajo de 200 ms', async () => {
    const res = await fetch(`${base}/api/test/seed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 1000, reset: true }) });
    expect(res.status).toBe(201);
    expect((await res.json()).inserted).toBe(1000);
    const t0 = performance.now();
    const tel = await (await fetch(`${base}/api/test/telemetry`)).json();
    expect(performance.now() - t0).toBeLessThan(200);
    expect(tel.matches).toBe(1000);
    const bad = await fetch(`${base}/api/test/seed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 5 }) });
    expect(bad.status).toBe(400);
  });
});

describe('Salas privadas por WebSocket', () => {
  it('protege la sala con contraseña y responde ping con pong', async () => {
    const a = client();
    const b = client();
    expect(await emit(a, 'room:create', { code: 'TEST1', password: 'secreta', name: 'ANA' })).toMatchObject({ ok: true, code: 'TEST1' });
    expect(await emit(b, 'room:join', { code: 'TEST1', password: 'mala' })).toEqual({ ok: false, error: 'Contraseña incorrecta' });
    expect(await emit(b, 'room:join', { code: 'NOEXISTE' })).toMatchObject({ ok: false });
    expect(await emit(b, 'room:join', { code: 'test1', password: 'secreta', name: 'BETO' })).toMatchObject({ ok: true });
    const pong = new Promise((resolve) => b.once('pong', resolve));
    b.emit('ping', { t: 123 });
    expect(await pong).toMatchObject({ t: 123 });
    a.close();
    b.close();
  });
});
