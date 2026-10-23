import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../level.js';

const DEADZONE = 0.35;

// Une teclado, mando (Gamepad API) y botones táctiles en un único objeto de input:
//   { left, right, down, jumpHeld, jumpPressed, fireHeld, pickupPressed, tauntPressed }
// Los "Pressed" se calculan por flanco (pulsado este frame y no el anterior), sea cual sea la fuente.
export default class Controls {
  constructor(scene) {
    this.scene = scene;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = scene.input.keyboard.addKeys({
      left: K.A, right: K.D, up: K.W, down: K.S,
      left2: K.LEFT, right2: K.RIGHT, up2: K.UP, down2: K.DOWN,
      space: K.SPACE, pickup: K.E, fire: K.F, fire2: K.J, taunt: K.Q,
    });
    this.touch = { left: false, right: false, down: false, jump: false, fire: false, pickup: false, taunt: false };
    this.prev = { jump: false, pickup: false, taunt: false };

    const forceTouch = new URLSearchParams(window.location.search).has('touch');
    if (forceTouch || scene.sys.game.device.input.touch) this.createTouchUi();
  }

  // Botones en pantalla (cámara de interfaz): dirección a la izquierda, acciones a la derecha.
  createTouchUi() {
    const s = this.scene;
    s.input.addPointer(3); // hasta 4 dedos a la vez
    const y = GAME_HEIGHT - 62;
    const defs = [
      ['left', '◀', 64, y, 40], ['right', '▶', 164, y, 40], ['down', '▼', 114, y - 86, 32],
      ['jump', '⤒', GAME_WIDTH - 70, y, 46], ['fire', '✹', GAME_WIDTH - 176, y + 6, 40],
      ['pickup', 'E', GAME_WIDTH - 120, y - 92, 30], ['taunt', '☺', GAME_WIDTH - 214, y - 80, 26],
    ];
    for (const [key, label, x, by, r] of defs) {
      const circle = s.add.circle(x, by, r, 0xffffff, 0.12).setStrokeStyle(2, 0xffffff, 0.45).setDepth(200);
      const text = s.add.text(x, by, label, { fontFamily: 'monospace', fontSize: `${Math.round(r * 0.8)}px`, color: '#ffffff' })
        .setOrigin(0.5).setAlpha(0.8).setDepth(201);
      s.juice.ui(circle);
      s.juice.ui(text);
      circle.setInteractive();
      const set = (v) => {
        this.touch[key] = v;
        circle.setFillStyle(0xffffff, v ? 0.35 : 0.12);
      };
      circle.on('pointerdown', () => set(true));
      circle.on('pointerup', () => set(false));
      circle.on('pointerout', () => set(false));
    }
  }

  readGamepad() {
    const pad = this.scene.input.gamepad?.pad1;
    if (!pad || !pad.connected) return null;
    const x = pad.leftStick.x;
    const y = pad.leftStick.y;
    return {
      left: pad.left || x < -DEADZONE,
      right: pad.right || x > DEADZONE,
      down: pad.down || y > 0.6,
      jump: pad.A,
      fire: pad.X || pad.B || pad.R2 > 0.4 || pad.R1 > 0.4,
      pickup: pad.Y,
      taunt: pad.L1 > 0.4,
    };
  }

  read() {
    const k = this.keys;
    const t = this.touch;
    const p = this.readGamepad() ?? {};
    const held = {
      left: k.left.isDown || k.left2.isDown || t.left || !!p.left,
      right: k.right.isDown || k.right2.isDown || t.right || !!p.right,
      down: k.down.isDown || k.down2.isDown || t.down || !!p.down,
      jump: k.up.isDown || k.up2.isDown || k.space.isDown || t.jump || !!p.jump,
      fire: k.fire.isDown || k.fire2.isDown || t.fire || !!p.fire,
      pickup: k.pickup.isDown || t.pickup || !!p.pickup,
      taunt: k.taunt.isDown || t.taunt || !!p.taunt,
    };
    const input = {
      left: held.left,
      right: held.right,
      down: held.down,
      jumpHeld: held.jump,
      jumpPressed: held.jump && !this.prev.jump,
      fireHeld: held.fire,
      pickupPressed: held.pickup && !this.prev.pickup,
      tauntPressed: held.taunt && !this.prev.taunt,
    };
    this.prev = { jump: held.jump, pickup: held.pickup, taunt: held.taunt };
    return input;
  }
}
