// Hilo aparte (worker_threads) del servidor para los mapas procedurales: en Render free (0.1 CPU)
// generar uno bloquearía el bucle de eventos medio segundo o más, y subiría el ping de todas las salas.
// Al empezar cada partida se piden sus mapas; GameRoom los encuentra ya hechos en la caché de mapGen.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { generateRows, matchJobs, adoptRows } from '../client/src/mapGen.js';

if (!isMainThread) {
  parentPort.on('message', (jobs) => {
    for (const { seed, themeIndex } of jobs) parentPort.postMessage({ seed, themeIndex, rows: generateRows(seed, themeIndex) });
  });
}

let worker = null;

export function prefetchMatchMaps(seed, matchNo = 0) {
  const jobs = matchJobs(seed, matchNo);
  if (!jobs.length) return;
  if (!worker) {
    worker = new Worker(new URL(import.meta.url), { execArgv: [] }); // sin --watch ni otras banderas del padre
    worker.unref(); // no impide que el proceso termine (pruebas, apagado)
    worker.on('message', ({ seed: s, themeIndex, rows }) => adoptRows(s, themeIndex, rows));
    worker.on('error', (e) => {
      console.error('mapPool:', e.message);
      worker = null; // se generarán en el hilo principal
    });
  }
  worker.postMessage(jobs);
}
