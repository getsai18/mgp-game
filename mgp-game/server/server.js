// Punto de entrada: arranca el servidor del juego (app.js) en PORT (Render lo define solo).
import { createGameServer, DEFAULT_DIST } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const server = createGameServer({ distDir: DEFAULT_DIST });
server.listen(PORT).then((port) => console.log(`Servidor escuchando en :${port}`));
