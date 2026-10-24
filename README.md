# Arena Caos — duelo 1 vs 1 multijugador en tiempo real

Videojuego web multijugador (HTML5 Canvas con Phaser 3) con servidor Node.js + WebSockets (socket.io)
y **autoridad del servidor** sobre la partida. Seis arenas, armas, bot con IA, controles de PC, mando y móvil.

- **URL pública (HTTPS):** https://54-162-107-181.sslip.io
- **Repositorio:** https://github.com/getsai18/mgp-game
- **Código:** carpeta [`mgp-game/`](mgp-game/)

## Cumplimiento de los lineamientos

| Módulo | Implementación | Dónde |
|---|---|---|
| **1. Red y Sockets** | WebSockets (socket.io, solo transporte `websocket`). El servidor es autoritativo: lleva la vida y calcula el daño, valida el inventario (arma, munición, cadencia), las armas del suelo (las recoge el primero que llega), el movimiento (límites del mundo y velocidad máxima) y decide rondas, marcador y fin de partida. Todos los mensajes se validan con esquemas **Zod** y tienen un límite de mensajes por segundo. Ping/pong cada 2 s con la latencia visible en pantalla. | `server/game.js`, `server/app.js`, `server/schemas.js` |
| **2. Motor y Controles** | Bucle de Phaser con *delta time*: la velocidad es la misma a 60, 120 o 144 Hz, y la física corre a paso fijo de 60 Hz. Contador de FPS en pantalla. En pantallas táctiles aparece una cruceta (abajo a la izquierda) y los botones de acción (abajo a la derecha); en PC se ocultan y se usa teclado (`keydown`/`keyup`) o mando. | `client/src/scenes/ArenaScene.js`, `client/src/touch.js`, `client/src/systems/Controls.js` |
| **3. Endpoints de prueba** | `GET /api/test/telemetry`, `POST /api/test/seed`, `GET /api/test/health`, `GET /api/test/ping`, `GET /api/test/rooms`. Todos devuelven la cabecera `X-Response-Time`. | `server/app.js`, `server/telemetry.js` |
| **4. Pruebas y CI/CD** | 26 pruebas Vitest (unitarias + integración) y 3 flujos E2E Playwright. Se ejecutan en GitHub Actions en cada push y Pull Request. | `mgp-game/tests/`, `.github/workflows/ci.yml` |
| **5. Despliegue** | Producción en AWS EC2 con HTTPS (Caddy + certificado Let's Encrypt válido) y WebSockets seguros (`wss://`). También queda listo el Blueprint de Render (`render.yaml`) como alternativa. | `mgp-game/AWS.md`, `render.yaml` |

## Endpoints de prueba

```bash
# Métricas agregadas: win rate (por lado y por jugador), KDR, supervivencia media, latencia, salas activas
curl https://54-162-107-181.sslip.io/api/test/telemetry

# Inyectar de 100 a 1000 partidas de prueba (reproducibles con "seed"; "reset" borra las anteriores)
curl -X POST https://54-162-107-181.sslip.io/api/test/seed -H "Content-Type: application/json" -d '{"count": 1000, "seed": 42, "reset": true}'

# También acepta partidas propias: {"matches": [{ "players": [{name,kills,deaths,won,survivalMs}, {...}], "rounds", "durationMs" }, ...]}
```

## Modos de juego

- **Partida rápida:** el servidor empareja con el primer jugador que esté esperando.
- **Sala privada:** crear una sala con código y contraseña opcional (guardada con hash `scrypt`). El rival entra con esas credenciales y la partida empieza cuando los dos marcan **LISTO**.
- **VS BOT** y **Práctica**, sin conexión.

Controles: `A`/`D` mover · `W` saltar · `S` apuntar abajo / atravesar plataformas · `F` disparar · `E` recoger o lanzar arma · `Q` burla.

## Ejecutar en local

```bash
cd mgp-game
npm ci
npm run dev          # servidor (:3000) + cliente Vite (:5173)
npm test             # Vitest: 26 pruebas unitarias / integración
npm run test:e2e     # build + Playwright: 3 flujos E2E (requiere: npx playwright install chromium)
npm run build && npm start   # producción en :3000
```

### Pruebas

- **Unitarias / integración (Vitest):**
  - generador de mapas (ASCII a geometría y conectividad del grafo del bot);
  - fórmulas de daño y escalado de explosiones;
  - esquemas Zod de payload;
  - interpolación de posiciones;
  - autoridad del servidor (cadencia, munición, impactos, rondas);
  - telemetría y API REST;
  - salas protegidas por WebSocket.
- **E2E (Playwright):**
  1. Autenticación: credenciales inválidas rechazadas y sala protegida.
  2. Lobby: crear sala, estado "Listo" y conexión de sockets.
  3. Canvas: inyección de controles y cambio de coordenadas del jugador en el DOM (`#game-state`).
