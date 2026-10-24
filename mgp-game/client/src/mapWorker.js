// Hilo aparte (Web Worker) del navegador: genera los mapas procedurales sin congelar el juego.
// Recibe { seed, themeIndex } y devuelve { seed, themeIndex, rows }.
import { generateRows } from './mapGen.js';

self.onmessage = ({ data }) => {
  for (const { seed, themeIndex } of data) self.postMessage({ seed, themeIndex, rows: generateRows(seed, themeIndex) });
};
