import { test, expect } from '@playwright/test';

// Estado del juego expuesto en el DOM para las pruebas (client/src/debugState.js).
const state = (page) => page.locator('#game-state');

// Dos jugadores en contextos aislados; se cierran al terminar para no dejar juegos corriendo (CI va sin GPU).
let contexts = [];
async function twoPlayers(browser) {
  contexts = [await browser.newContext(), await browser.newContext()];
  return Promise.all(contexts.map((c) => c.newPage()));
}
test.afterEach(async () => {
  await Promise.all(contexts.map((c) => c.close()));
  contexts = [];
});

// Abre el juego y entra en la pantalla de sala privada.
async function openLobby(page) {
  await page.goto('/');
  await expect(state(page)).toHaveAttribute('data-scene', 'title');
  await page.evaluate(() => window.__game.scene.getScene('Title').start('lobby'));
  await expect(state(page)).toHaveAttribute('data-scene', 'lobby');
}

test('Flujo 1 · Autenticación: credenciales inválidas rechazadas y sala protegida', async ({ browser }) => {
  const [host, guest] = await twoPlayers(browser);
  const code = `A${Date.now() % 100000}`;

  await openLobby(host);
  await host.fill('#lobby-code', code);
  await host.fill('#lobby-pass', 'clave123');
  await host.click('#lobby-create');
  await expect(host.locator('#lobby-room-code')).toContainText(code);

  await openLobby(guest);
  await guest.fill('#lobby-code', code);
  await guest.fill('#lobby-pass', 'incorrecta');
  await guest.click('#lobby-join');
  await expect(guest.locator('#lobby-status')).toHaveText('Contraseña incorrecta');
  await expect(guest.locator('#lobby-room')).toBeHidden(); // no entró

  await guest.fill('#lobby-pass', 'clave123');
  await guest.click('#lobby-join');
  await expect(guest.locator('#lobby-room')).toBeVisible();
  await expect(host.locator('#lobby-players li')).toHaveCount(2);
});

test('Flujo 2 · Lobby: crear sala, marcar "Listo" y conectar los sockets de la partida', async ({ browser }) => {
  const [host, guest] = await twoPlayers(browser);
  const code = `L${Date.now() % 100000}`;

  await openLobby(host);
  await host.fill('#lobby-code', code);
  await host.click('#lobby-create');
  await openLobby(guest);
  await guest.fill('#lobby-code', code);
  await guest.click('#lobby-join');
  await expect(host.locator('#lobby-players li')).toHaveCount(2);

  await host.click('#lobby-ready');
  await expect(guest.locator('#lobby-players li[data-ready="1"]')).toHaveCount(1); // el estado viaja por socket
  await guest.click('#lobby-ready');

  for (const page of [host, guest]) {
    await expect(state(page)).toHaveAttribute('data-scene', 'arena');
    await expect(state(page)).toHaveAttribute('data-opponent', '1');
    expect(await page.evaluate(() => window.__socket.connected)).toBe(true);
  }
  // Ping/pong medido contra el servidor.
  await expect(state(host)).toHaveAttribute('data-ping', /\d+/);
});

test('Flujo 3 · Canvas: inyectar controles y comprobar que cambian las coordenadas del jugador', async ({ page }) => {
  await page.goto('/');
  await expect(state(page)).toHaveAttribute('data-scene', 'title');
  await page.evaluate(() => window.__game.scene.getScene('Title').start('offline'));
  await expect(state(page)).toHaveAttribute('data-scene', 'arena');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(800); // aterriza en su aparición

  // Sin GPU (CI) el juego va a pocos FPS: se mantiene la tecla hasta ver el cambio, sin depender del tiempo.
  const x0 = Number(await state(page).getAttribute('data-x'));
  await page.keyboard.down('d');
  await expect.poll(async () => Number(await state(page).getAttribute('data-x')), { timeout: 30_000 }).toBeGreaterThan(x0 + 40);
  await page.keyboard.up('d');

  const y0 = Number(await state(page).getAttribute('data-y'));
  await page.keyboard.down('w');
  await expect.poll(async () => Number(await state(page).getAttribute('data-y')), { timeout: 30_000 }).toBeLessThan(y0 - 30); // salta
  await page.keyboard.up('w');
});
