import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from '../level.js';
import { MAPS } from '../maps.js';
import { drawMapBackground } from '../mapTiles.js';
import { bake } from '../systems/Juice.js';
import { PLAYER_COLORS } from '../skins.js';
import { socket, session, createRoom, joinRoom, setReady, leaveRoom } from '../net.js';
import { play } from '../audio.js';
import { setDebugState } from '../debugState.js';

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// Lobby de salas privadas: crear sala (código + contraseña opcional) o unirse con sus credenciales;
// dentro, cada jugador marca "Listo" y la partida empieza cuando los dos lo están (lo decide el servidor).
// El formulario es HTML (elemento DOM de Phaser): accesible y fácil de automatizar en las pruebas E2E.
const HTML = `
<div id="lobby" style="width:440px;padding:18px 22px;background:#0b0b14e8;border:3px solid #ffffff44;border-radius:10px;
  font:bold 15px monospace;color:#fff;text-align:center;box-shadow:0 8px 30px #000a">
  <div style="font-size:22px;color:#ffd27a;margin-bottom:12px">SALA PRIVADA</div>
  <div id="lobby-form">
    <input id="lobby-code" maxlength="8" placeholder="CÓDIGO (3-8 letras/números)" autocomplete="off"
      style="width:100%;box-sizing:border-box;margin:4px 0;padding:8px;font:bold 16px monospace;text-transform:uppercase;text-align:center;border-radius:6px;border:2px solid #1b1d3a">
    <input id="lobby-pass" type="password" maxlength="32" placeholder="CONTRASEÑA (opcional)" autocomplete="off"
      style="width:100%;box-sizing:border-box;margin:4px 0;padding:8px;font:bold 16px monospace;text-align:center;border-radius:6px;border:2px solid #1b1d3a">
    <div style="display:flex;gap:10px;margin-top:10px">
      <button id="lobby-create" style="flex:1;padding:10px;font:bold 16px monospace;color:#fff;background:#2e7d32;border:2px solid #000;border-radius:6px;cursor:pointer">CREAR SALA</button>
      <button id="lobby-join" style="flex:1;padding:10px;font:bold 16px monospace;color:#fff;background:#1f5fa8;border:2px solid #000;border-radius:6px;cursor:pointer">UNIRSE</button>
    </div>
  </div>
  <div id="lobby-room" style="display:none">
    <div id="lobby-room-code" style="font-size:18px;margin-bottom:8px"></div>
    <ul id="lobby-players" style="list-style:none;padding:0;margin:6px 0 12px;text-align:left"></ul>
    <button id="lobby-ready" style="width:100%;padding:12px;font:bold 18px monospace;color:#fff;background:#8e2c2c;border:2px solid #000;border-radius:6px;cursor:pointer">LISTO</button>
  </div>
  <div id="lobby-status" role="status" style="min-height:20px;margin-top:10px;color:#cfd6e6;font-size:13px"></div>
  <button id="lobby-back" style="margin-top:8px;padding:6px 14px;font:bold 13px monospace;color:#fff;background:#37474f;border:2px solid #000;border-radius:6px;cursor:pointer">◀ VOLVER</button>
</div>`;

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super('Lobby');
  }

  create() {
    this.cameras.main.setZoom(RENDER_SCALE).centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const map = MAPS[4];
    const bg = drawMapBackground(this, map);
    const fit = GAME_WIDTH / map.width;
    bake(this, bg.far, map.width, map.height).setScale(fit);
    bake(this, bg.near, map.width, map.height).setScale(fit);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0b14, 0.45);

    this.ready = false;
    this.leaving = false;
    this.form = this.add.dom(GAME_WIDTH / 2, GAME_HEIGHT / 2).createFromHTML(HTML);
    const $ = (id) => this.form.getChildByID(id);
    this.$ = $;
    // Que escribir en los campos no active atajos del juego.
    this.form.node.addEventListener('keydown', (e) => e.stopPropagation());
    $('lobby-create').addEventListener('click', () => this.submit(createRoom));
    $('lobby-join').addEventListener('click', () => this.submit(joinRoom));
    $('lobby-ready').addEventListener('click', () => {
      this.ready = !this.ready;
      setReady(this.ready);
      play('click');
    });
    $('lobby-back').addEventListener('click', () => this.back());

    const handlers = {
      'room:state': (s) => this.renderRoom(s),
      match_start: () => this.go(),
      disconnect: () => !this.leaving && this.status('Conexión perdida con el servidor', true),
    };
    for (const [evt, fn] of Object.entries(handlers)) socket.on(evt, fn);
    this.events.once('shutdown', () => Object.entries(handlers).forEach(([evt, fn]) => socket.off(evt, fn)));
    this.input.keyboard.on('keydown-ESC', () => this.back());
    setDebugState({ scene: 'lobby' });
  }

  status(text, error = false) {
    const el = this.$('lobby-status');
    el.textContent = text;
    el.style.color = error ? '#ff7a7a' : '#cfd6e6';
    el.dataset.error = error ? '1' : '';
  }

  async submit(action) {
    const code = this.$('lobby-code').value.trim().toUpperCase();
    const pass = this.$('lobby-pass').value;
    play('click');
    this.status('Conectando...');
    const res = await action(code, pass);
    if (!res?.ok) return this.status(res?.error ?? 'Error', true);
    this.$('lobby-form').style.display = 'none';
    this.$('lobby-room').style.display = 'block';
    this.$('lobby-room-code').textContent = `SALA ${res.code}${res.protected ? ' 🔒' : ''}`;
    this.status('Marca LISTO cuando estés preparado');
    setDebugState({ scene: 'lobby', room: res.code });
  }

  renderRoom(state) {
    const list = this.$('lobby-players');
    list.innerHTML = '';
    for (const p of [...state.players].sort((a, b) => a.index - b.index)) {
      const li = document.createElement('li');
      li.dataset.ready = p.ready ? '1' : '0';
      li.style.cssText = `padding:6px 10px;margin:4px 0;border-radius:6px;background:#ffffff14;color:${hex(PLAYER_COLORS[p.index])}`;
      li.textContent = `J${p.index + 1}  ${p.name}${p.index === session.playerIndex ? ' (tú)' : ''}  —  ${p.ready ? '✔ LISTO' : '… esperando'}`;
      list.appendChild(li);
    }
    if (state.players.length < 2) this.status('Esperando a un rival · comparte el código y la contraseña');
    else this.status(state.players.every((p) => p.ready) ? '¡Empezando!' : 'Los dos deben marcar LISTO');
    const btn = this.$('lobby-ready');
    btn.textContent = this.ready ? 'LISTO ✔ (cancelar)' : 'LISTO';
    btn.style.background = this.ready ? '#2e7d32' : '#8e2c2c';
  }

  go() {
    this.leaving = true;
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Arena', { mode: 'online', lobby: true }));
  }

  back() {
    if (this.leaving) return;
    this.leaving = true;
    leaveRoom();
    this.scene.start('Title');
  }
}
