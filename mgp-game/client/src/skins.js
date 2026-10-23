// Personaje: soldado chibi con armadura gigante y cabeza diminuta (inspirado en el estilo Gears).
// El color del jugador va en el pañuelo de la cabeza y en las luces de la armadura.
// Se dibuja por código (sin assets) en todas sus poses, para cada jugador, sin arma (puños)
// y con arma (las dos manos al frente sujetándola; el arma la dibuja WeaponSystem).
export const PLAYER_COLORS = [0x4fc3f7, 0xff6e6e];
export const POSES = ['idle', 'run0', 'run1', 'jump', 'fall'];
export const SKIN_W = 28;
export const SKIN_H = 40;

export const skinKey = (skin, pose, armed) => `gear${skin}_${pose}${armed ? '_armed' : ''}`;

const ARMOR = { base: 0x56606c, dark: 0x363d46, light: 0x8b97a6, boot: 0x24282d };
const FACE = { skin: 0xd9a070, stubble: 0xa8744c, eye: 0x1a1a1a };

// Poses mirando a la derecha. Hombros en (8,17) y (20,17), caderas en (11,30) y (17,30).
//   hands: [mano trasera, mano delantera] (sin arma); feet: [pie trasero, pie delantero]
const POSE_DATA = {
  idle: { hands: [[7, 27], [22, 27]], feet: [[10, 39], [18, 39]] },
  run0: { hands: [[4, 22], [25, 23]], feet: [[6, 38], [22, 37]] },
  run1: { hands: [[9, 28], [20, 28]], feet: [[12, 39], [16, 39]] },
  jump: { hands: [[4, 11], [24, 10]], feet: [[9, 35], [19, 36]] },
  fall: { hands: [[3, 15], [25, 15]], feet: [[11, 39], [17, 39]] },
};
const ARMED_HANDS = [[17, 24], [22, 23]]; // con arma: ambas manos donde se dibuja el arma

export function generateSkinTextures(scene) {
  const g = scene.make.graphics({ add: false });
  PLAYER_COLORS.forEach((color, skin) => {
    for (const pose of POSES) {
      for (const armed of [false, true]) {
        const data = POSE_DATA[pose];
        drawGear(g, armed ? { ...data, hands: ARMED_HANDS } : data, color);
        g.generateTexture(skinKey(skin, pose, armed), SKIN_W, SKIN_H);
        g.clear();
      }
    }
  });
  g.destroy();
}

function glow(g, x, y, w, h, color) {
  g.fillStyle(color, 0.35).fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle(color).fillRect(x, y, w, h);
  g.fillStyle(0xffffff, 0.6).fillRect(x, y, Math.max(1, w - 1), 1);
}

function limb(g, from, to, color, width) {
  g.lineStyle(width, color).lineBetween(from[0], from[1], to[0], to[1]);
}

function drawGear(g, p, color) {
  const [backHand, frontHand] = p.hands;
  const [backFoot, frontFoot] = p.feet;

  // --- Detrás del torso: brazo y pierna traseros, hombrera trasera ---
  limb(g, [8, 17], backHand, ARMOR.dark, 5);
  g.fillStyle(ARMOR.boot).fillCircle(backHand[0], backHand[1], 2.5);
  limb(g, [11, 30], backFoot, ARMOR.dark, 5);
  g.fillStyle(ARMOR.boot).fillRect(backFoot[0] - 3, Math.min(backFoot[1], 38) - 1, 6, 3);
  g.fillStyle(ARMOR.dark).fillRoundedRect(2, 12, 10, 8, 3);

  // --- Pierna delantera ---
  limb(g, [17, 30], frontFoot, ARMOR.base, 5);
  g.fillStyle(ARMOR.boot).fillRect(frontFoot[0] - 3, Math.min(frontFoot[1], 38) - 1, 7, 3);

  // --- Torso blindado (ancho y bajito) ---
  g.fillStyle(ARMOR.base).fillRoundedRect(6, 14, 16, 17, 3);
  g.fillStyle(ARMOR.light).fillRect(8, 15, 2, 12); // brillo lateral
  g.fillStyle(ARMOR.dark);
  g.fillRect(6, 24, 16, 1); // placas
  g.fillRect(13, 15, 1, 9);
  g.fillRect(6, 28, 16, 3); // cinturón
  glow(g, 15, 19, 4, 2, color); // luz del pecho
  glow(g, 10, 29, 2, 1, color);
  glow(g, 18, 29, 2, 1, color);

  // --- Cabeza diminuta: cuello blindado, cara de rudo, pañuelo ---
  g.fillStyle(ARMOR.dark).fillRect(9, 12, 10, 3);
  g.fillStyle(FACE.skin).fillRoundedRect(10, 4, 8, 9, 2);
  g.fillStyle(FACE.stubble).fillRect(11, 10, 7, 3); // barba de varios días
  g.fillStyle(FACE.skin).fillRect(14, 11, 3, 1); // boca apretada (hueco en la barba)
  g.fillStyle(FACE.eye).fillRect(13, 8, 2, 1).fillRect(16, 8, 2, 1); // ojos entrecerrados
  g.lineStyle(1, 0x3a2410).lineBetween(12.5, 6.6, 15, 7.4).lineBetween(15.5, 7.4, 18, 6.6); // ceño
  g.fillStyle(color).fillRoundedRect(9, 2, 10, 4, { tl: 3, tr: 3, bl: 0, br: 0 }); // pañuelo
  g.fillStyle(0xffffff, 0.3).fillRect(11, 2, 6, 1);
  g.fillStyle(color).fillTriangle(9, 3, 9, 6, 5, 5).fillTriangle(9, 5, 9, 7, 6, 9); // nudo ondeando

  // --- Hombrera delantera gigante ---
  g.fillStyle(ARMOR.base).fillRoundedRect(16, 11, 11, 8, 3);
  g.fillStyle(ARMOR.light).fillRect(17, 11, 8, 2);
  g.fillStyle(ARMOR.dark).fillRect(16, 17, 11, 2);
  glow(g, 23, 14, 2, 2, color);

  // --- Brazo delantero con puño blindado ---
  limb(g, [20, 18], frontHand, ARMOR.base, 5);
  g.fillStyle(ARMOR.boot).fillCircle(frontHand[0], frontHand[1], 3);
  g.fillStyle(ARMOR.light).fillRect(frontHand[0] - 1, frontHand[1] - 2, 2, 1);
}
