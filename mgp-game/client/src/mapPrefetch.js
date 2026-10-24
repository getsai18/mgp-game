// Calcula por adelantado, en un Web Worker, los mapas procedurales de la partida (generarlos y
// validarlos son decenas de ms: en el hilo del juego sería un tirón al empezar la ronda).
// Si una ronda empieza antes de tenerlo, mapGen.roundMap lo genera ahí mismo como antes.
import { matchJobs, adoptRows } from './mapGen.js';

let worker = null;

export function prefetchMatchMaps(seed, matchNo = 0) {
  const jobs = matchJobs(seed, matchNo);
  if (!jobs.length || typeof Worker === 'undefined') return;
  if (!worker) {
    try {
      worker = new Worker(new URL('./mapWorker.js', import.meta.url), { type: 'module' });
    } catch {
      return; // sin workers: se generan al empezar cada ronda
    }
    worker.onmessage = ({ data }) => adoptRows(data.seed, data.themeIndex, data.rows);
  }
  worker.postMessage(jobs);
}
