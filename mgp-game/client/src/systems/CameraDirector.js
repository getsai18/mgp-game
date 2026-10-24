import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../level.js';

// Cámara de duelo (estilo Smash / TowerFall): encuadra a los dos jugadores con margen.
// Juntos -> zoom de cerca (MAX_ZOOM, el aspecto clásico); separados -> se aleja hasta ver el mapa entero.
// Todo local y cosmético: cada cliente encuadra lo suyo, nada viaja por red.
const MAX_ZOOM = 1.5;
const SOLO_ZOOM = 1.3; // práctica sin rival: algo de contexto alrededor del jugador
const PAD_X = 230; // margen alrededor de los jugadores (px de mundo)
const PAD_Y = 170;
const LOOK_UP = 30; // el encuadre sube un poco: se ve más lo que hay encima que el suelo
const ZOOM_RATE = 2.6; // suavizado exponencial (1/s)
const MOVE_RATE = 5;

export default class CameraDirector {
  constructor(scene) {
    this.scene = scene;
    this.cam = scene.cameras.main;
    this.minZoom = 1;
    this.focusUntil = 0; // kill-cam: encuadre fijo hasta este instante
    this.focus = null;
    this.lastTargets = [];
    this.x = CANVAS_WIDTH / 2;
    this.y = CANVAS_HEIGHT / 2;
    this.zoom = 1;
  }

  // Al cambiar de mapa: límites nuevos y plano general (para que se vea el escenario al empezar).
  setWorld(width, height) {
    this.width = width;
    this.height = height;
    this.cam.setBounds(0, 0, width, height);
    // Zoom mínimo = el que cubre el lienzo sin enseñar nada fuera del mapa.
    this.minZoom = Math.max(CANVAS_WIDTH / width, CANVAS_HEIGHT / height);
    this.snap(width / 2, height / 2, this.minZoom);
  }

  snap(x, y, zoom) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.apply();
  }

  // Encuadre fijo durante `ms` (kill-cam); luego vuelve sola, suavemente, al encuadre de duelo.
  focusOn(x, y, zoomMul, ms) {
    this.focus = { x, y, zoom: Math.min(this.zoom * zoomMul, MAX_ZOOM * 1.35) };
    this.focusUntil = performance.now() + ms;
  }

  // Puntos a encuadrar: jugadores vivos y visibles (o, durante la repetición, sus actores).
  targets() {
    const s = this.scene;
    if (s.replay?.playing && s.replay.focus.length) return s.replay.focus;
    const list = [];
    for (const p of [s.player, s.remote]) if (p && p.visible && p.alive && p.active) list.push(p);
    // Recién muerto: mantener el último encuadre un momento en vez de saltar.
    if (list.length) this.lastTargets = list.map((p) => ({ x: p.x, y: p.y }));
    return list.length ? list : this.lastTargets;
  }

  update(delta) {
    const dt = Math.min(delta, 50) / 1000;
    let tx, ty, tz, moveRate = MOVE_RATE, zoomRate = ZOOM_RATE;
    if (this.focus && performance.now() < this.focusUntil) {
      ({ x: tx, y: ty, zoom: tz } = this.focus);
      moveRate = zoomRate = 14; // la kill-cam entra rápido
    } else {
      this.focus = null;
      const pts = this.targets();
      if (!pts.length) {
        tx = this.width / 2;
        ty = this.height / 2;
        tz = this.minZoom;
      } else {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of pts) {
          const py = Phaser.Math.Clamp(p.y, 0, this.height); // por encima del mapa o cayendo: no perseguirlo
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
        tx = (x0 + x1) / 2;
        ty = (y0 + y1) / 2 - LOOK_UP;
        const fit = Math.min(CANVAS_WIDTH / (x1 - x0 + PAD_X * 2), CANVAS_HEIGHT / (y1 - y0 + PAD_Y * 2));
        tz = Phaser.Math.Clamp(Math.min(fit, pts.length === 1 && this.scene.round?.phase === 'solo' ? SOLO_ZOOM : MAX_ZOOM), this.minZoom, MAX_ZOOM * 1.35);
      }
    }
    this.zoom += (tz - this.zoom) * (1 - Math.exp(-zoomRate * dt));
    this.x += (tx - this.x) * (1 - Math.exp(-moveRate * dt));
    this.y += (ty - this.y) * (1 - Math.exp(-moveRate * dt));
    this.apply();
  }

  apply() {
    // Con los límites puestos, Phaser recorta el desplazamiento para no enseñar fuera del mapa.
    this.cam.setZoom(Math.max(this.zoom, this.minZoom));
    this.cam.centerOn(this.x, this.y);
  }

  // ¿Está un punto del mundo dentro de lo que se ve? (para indicadores de fuera de pantalla)
  sees(x, y, margin = 0) {
    const v = this.cam.worldView;
    return x >= v.x - margin && x <= v.right + margin && y >= v.y - margin && y <= v.bottom + margin;
  }
}
