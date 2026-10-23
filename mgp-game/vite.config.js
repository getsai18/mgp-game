import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1600 }, // Phaser pesa ~1.2 MB
  server: {
    port: 5173,
    host: true, // permite probar desde otro PC/móvil en la LAN
    proxy: {
      // SERVER_PORT permite levantar una segunda copia (p. ej. pruebas) sin chocar con la tuya.
      '/socket.io': { target: `http://localhost:${process.env.SERVER_PORT || 3000}`, ws: true },
    },
  },
});
