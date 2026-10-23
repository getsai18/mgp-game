# Pendientes

## Fase 6 — Deploy en AWS (gasto $0)

Objetivo: dejar el juego accesible por internet para jugar 1vs1 desde dos PCs.

- [ ] Crear instancia EC2 **t4g.micro** (ARM, capa gratuita) con Ubuntu LTS.
- [ ] Security Group: abrir puerto **80** (HTTP) y **22** (SSH solo desde tu IP).
- [ ] Instalar Node.js LTS en la instancia.
- [ ] Copiar/clonar el proyecto, `npm ci` y `npm run build` (genera `dist/`).
- [ ] Arrancar con **pm2** (`pm2 start server/server.js --name arena`, `pm2 save`, `pm2 startup`) para que se reinicie solo.
- [ ] Servir en el puerto 80: `PORT=80` (con `setcap` para Node) o redirección `iptables` 80 → 3000.
- [ ] Script `user-data` para que la instancia se configure sola al crearse.
- [ ] Probar desde dos PCs distintos con `http://<IP-pública>`.
- [ ] (Opcional) Elastic IP para que la IP no cambie al reiniciar la instancia.
- [ ] (Opcional) Dominio + HTTPS con Caddy si hace falta compartir un enlace "bonito".

Notas:
- El servidor ya sirve el build (`dist/`) y el WebSocket en el mismo puerto: no hace falta nginx.
- Endpoint de salud para comprobar que está vivo: `GET /health` → `ok`.
