import Phaser from 'phaser';
import { touchState } from '../touch.js';

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
    this.touch = touchState; // botones táctiles en HTML (touch.js)
    this.prev = { jump: false, pickup: false, taunt: false };
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
