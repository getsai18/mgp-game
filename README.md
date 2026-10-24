# Arena Caos — duelo 1 vs 1 multijugador en tiempo real

Videojuego web multijugador (**HTML5 Canvas 2D** con Phaser 3) con servidor Node.js + WebSockets (socket.io)
y **autoridad del servidor** sobre la partida. Seis arenas, armas, bot con IA, controles de PC, mando y móvil.

- **URL pública (HTTPS, Render):** https://arena-caos.onrender.com
- **Repositorio:** https://github.com/getsai18/mgp-game
- **Código:** carpeta [`mgp-game/`](mgp-game/)

## Cumplimiento de los lineamientos

| Módulo | Implementación | Dónde |
|---|---|---|
| **1. Red y Sockets** | WebSockets (socket.io, solo transporte `websocket`). El servidor es autoritativo y tiene su propia copia del mapa (`server/arbiter.js`): **colisiones** (rechaza y corrige con `player_correct` cualquier posición dentro o a través de una pared, y teletransportes por velocidad), **muertes** por agua, vacío y pinchos (las detecta él, el cliente no las anuncia), **daño** (el cliente solo dice "le di con el arma w"; el servidor comprueba trayectoria, alcance y línea de visión contra las posiciones recientes del rival y calcula el daño, en las explosiones por distancia), inventario (arma, munición, cadencia), armas del suelo, apariciones (al empezar cada ronda solo se acepta al jugador en su punto) y rondas, marcador y fin de partida. Todos los mensajes se validan con esquemas **Zod** y tienen un límite por segundo. Ping/pong cada 2 s con la latencia en pantalla; la telemetría da media, mediana, p95 y % bajo 100 ms (sin medir con la pestaña en segundo plano). | `server/game.js`, `server/arbiter.js`, `server/app.js`, `server/schemas.js` |
| **2. Motor y Controles** | Renderizado **Canvas 2D** (`Phaser.CANVAS`; tintes y mezclas en `systems/CanvasTint.js`). Bucle con *delta time*: la velocidad es la misma a 60, 120 o 144 Hz, y la física corre a paso fijo de 60 Hz. Contador de FPS en pantalla. En pantallas táctiles aparece una cruceta (abajo a la izquierda) y los botones de acción (abajo a la derecha); en PC se ocultan y se usa teclado (`keydown`/`keyup`) o mando. | `client/src/scenes/ArenaScene.js`, `client/src/touch.js`, `client/src/systems/Controls.js` |
| **3. Endpoints de prueba** | `GET /api/test/telemetry`, `POST /api/test/seed`, `GET /api/test/health`, `GET /api/test/ping`, `GET /api/test/rooms`. Todos devuelven la cabecera `X-Response-Time`. | `server/app.js`, `server/telemetry.js` |
| **4. Pruebas y CI/CD** | 38 pruebas Vitest (unitarias + integración) y 3 flujos E2E Playwright. Se ejecutan en GitHub Actions en cada push y Pull Request. | `mgp-game/tests/`, `.github/workflows/ci.yml` |
| **5. Despliegue** | Producción en **Render** (Blueprint `render.yaml`, región Virginia, SSL automático y `wss://`), con despliegue automático en cada push a `main`. Un workflow hace ping a `/health` cada 10 min para que el plan gratuito no se duerma. | `render.yaml`, `.github/workflows/keepalive.yml` |

## Endpoints de prueba

```bash
# Métricas agregadas: win rate (por lado y por jugador), KDR, supervivencia media, latencia (media, p50, p95), salas activas
curl https://arena-caos.onrender.com/api/test/telemetry

# Inyectar de 100 a 1000 partidas de prueba (reproducibles con "seed"; "reset" borra las anteriores)
curl -X POST https://arena-caos.onrender.com/api/test/seed -H "Content-Type: application/json" -d '{"count": 1000, "seed": 42, "reset": true}'

# También acepta partidas propias: {"matches": [{ "players": [{name,kills,deaths,won,survivalMs}, {...}], "rounds", "durationMs" }, ...]}
```

## Mapas

Seis mapas dibujados a mano (ASCII) y **mapas procedurales**: las rondas impares usan los de mano y las pares
un mapa generado con una semilla que el servidor manda al empezar la partida (`match_start`), con el estilo
de uno de los seis. El generador (`client/src/mapGen.js`) crea la mitad izquierda (suelo con huecos,
3-4 niveles de plataformas, aparición, armas, pinchos y decorado) y la refleja; cada mapa se valida con el
grafo del bot, que simula los saltos, y si no es jugable se prueba otra semilla. Servidor y clientes calculan
el mismo mapa con la misma semilla. En práctica, `M` recorre los mapas y genera uno nuevo.

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
npm test             # Vitest: 38 pruebas unitarias / integración
npm run test:e2e     # build + Playwright: 3 flujos E2E (requiere: npx playwright install chromium)
npm run build && npm start   # producción en :3000
```

### Pruebas

- **Unitarias / integración (Vitest):**
  - generador de mapas (ASCII a geometría y conectividad del grafo del bot);
  - generador **procedural** de mapas (misma semilla = mismo mapa, simetría, siempre jugable);
  - fórmulas de daño y escalado de explosiones;
  - esquemas Zod de payload;
  - interpolación de posiciones;
  - autoridad del servidor (cadencia, munición, daño calculado por el servidor, línea de visión,
    paredes, muertes por agua / pinchos, aparición, rondas);
  - telemetría y API REST;
  - salas protegidas por WebSocket.
- **E2E (Playwright):**
  1. Autenticación: credenciales inválidas rechazadas y sala protegida.
  2. Lobby: crear sala, estado "Listo" y conexión de sockets.
  3. Canvas: inyección de controles y cambio de coordenadas del jugador en el DOM (`#game-state`).
