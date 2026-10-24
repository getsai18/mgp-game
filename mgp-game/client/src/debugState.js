// Estado visible en el DOM para las pruebas automáticas (E2E): un <div id="game-state" hidden> con
// atributos data-* (escena, modo, sala, posición del jugador...). No afecta al juego.
let el = null;

export function setDebugState(values) {
  if (typeof document === 'undefined') return;
  if (!el) {
    el = document.getElementById('game-state') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'game-state', hidden: true }));
  }
  for (const [k, v] of Object.entries(values)) el.dataset[k] = String(v);
}
