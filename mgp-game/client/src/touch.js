// Controles táctiles en HTML, fuera del canvas: tamaño real en el teléfono (no se encogen con el
// escalado del juego) y aprovechan las barras negras laterales de los móviles alargados.
// Varios dedos a la vez; el dedo puede deslizarse entre botones (◀ ▶ ▼ son una sola cruceta).
//
// Controls.js lee `touchState` cada frame. La escena Arena muestra la capa con showTouchControls().

export const isTouch =
  new URLSearchParams(window.location.search).has('touch') ||
  'ontouchstart' in window ||
  navigator.maxTouchPoints > 0;

export const touchState = { left: false, right: false, down: false, jump: false, fire: false, pickup: false, taunt: false };

const DPAD_DEAD = 0.25; // fracción del radio de la cruceta sin dirección
const HIT_MARGIN = 14; // px extra alrededor de cada botón al deslizar el dedo

let layer = null;
let actions = {}; // { menu, sound, fullscreen } -> callback
const pointers = new Map(); // pointerId -> { x, y }

if (isTouch) document.documentElement.classList.add('touch');

function build() {
  layer = document.createElement('div');
  layer.id = 'touch-layer';
  layer.innerHTML = `
    <div class="t-dpad" data-btn="dpad">
      <span class="t-arrow t-l">◀</span><span class="t-arrow t-r">▶</span><span class="t-arrow t-d">▼</span>
    </div>
    <div class="t-btn t-jump" data-btn="jump">⤒</div>
    <div class="t-btn t-fire" data-btn="fire">✹</div>
    <div class="t-btn t-pickup" data-btn="pickup">E</div>
    <div class="t-btn t-taunt" data-btn="taunt">☺</div>
    <div class="t-menu">
      <div class="t-small" data-act="menu">✕</div>
      <div class="t-small" data-act="sound">🔊</div>
      <div class="t-small" data-act="fullscreen">⛶</div>
    </div>`;
  document.body.appendChild(layer);

  layer.addEventListener('pointerdown', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) {
      e.preventDefault();
      actions[act.dataset.act]?.();
      return;
    }
    if (!e.target.closest('[data-btn]')) return;
    e.preventDefault();
    // El ratón (?touch en PC) también sigue al deslizar. Lanza si el puntero ya no está activo.
    try { e.target.setPointerCapture(e.pointerId); } catch { /* sin captura: el toque ya la tiene implícita */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    recompute();
  });
  layer.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    recompute();
  });
  const release = (e) => {
    if (pointers.delete(e.pointerId)) recompute();
  };
  layer.addEventListener('pointerup', release);
  layer.addEventListener('pointercancel', release);
  layer.addEventListener('contextmenu', (e) => e.preventDefault());
}

function inside(rect, p, margin) {
  return p.x >= rect.left - margin && p.x <= rect.right + margin && p.y >= rect.top - margin && p.y <= rect.bottom + margin;
}

// El estado sale de dónde están TODOS los dedos ahora, no de qué botón tocaron al empezar.
function recompute() {
  for (const k of Object.keys(touchState)) touchState[k] = false;
  const dpad = layer.querySelector('.t-dpad').getBoundingClientRect();
  const buttons = [...layer.querySelectorAll('.t-btn')].map((el) => [el.dataset.btn, el.getBoundingClientRect()]);
  for (const p of pointers.values()) {
    if (inside(dpad, p, HIT_MARGIN * 2)) {
      const r = dpad.width / 2;
      const dx = (p.x - (dpad.left + r)) / r;
      const dy = (p.y - (dpad.top + dpad.height / 2)) / r;
      if (dx < -DPAD_DEAD) touchState.left = true;
      if (dx > DPAD_DEAD) touchState.right = true;
      if (dy > DPAD_DEAD + 0.15) touchState.down = true;
      continue;
    }
    for (const [key, rect] of buttons) {
      if (inside(rect, p, HIT_MARGIN)) touchState[key] = true;
    }
  }
  layer.querySelector('.t-l').classList.toggle('on', touchState.left);
  layer.querySelector('.t-r').classList.toggle('on', touchState.right);
  layer.querySelector('.t-d').classList.toggle('on', touchState.down);
  for (const el of layer.querySelectorAll('.t-btn')) el.classList.toggle('on', touchState[el.dataset.btn]);
}

export function showTouchControls(callbacks) {
  if (!isTouch) return;
  if (!layer) build();
  actions = callbacks;
  pointers.clear();
  recompute();
  layer.style.display = 'block';
}

export function hideTouchControls() {
  if (!layer) return;
  pointers.clear();
  recompute();
  layer.style.display = 'none';
}

export function setSoundIcon(muted) {
  const el = layer?.querySelector('[data-act="sound"]');
  if (el) el.textContent = muted ? '🔇' : '🔊';
}

// Pantalla completa + horizontal. Debe llamarse desde un toque del usuario.
// Android lo permite; iPhone (Safari) no deja ni pantalla completa ni bloquear la orientación.
export function enterFullscreen() {
  const el = document.documentElement;
  if (!isTouch || document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else enterFullscreen();
}
