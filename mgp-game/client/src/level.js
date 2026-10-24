// Constantes globales del escenario. La geometría, el estilo y la zona de muerte
// de cada mapa están en maps.js.
//
// GAME_WIDTH x GAME_HEIGHT es el espacio lógico de la interfaz (HUD, menús): todo el HUD se
// coloca en estas coordenadas. El lienzo real es RENDER_SCALE veces mayor (1440x810): así un
// mapa de 1440 px de ancho se ve entero con zoom 1 (píxel a píxel, sin perder líneas del pixel art)
// y de cerca con zoom 1.5 (el aspecto de antes). La cámara de interfaz lleva zoom RENDER_SCALE.
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const RENDER_SCALE = 1.5;
export const CANVAS_WIDTH = GAME_WIDTH * RENDER_SCALE;
export const CANVAS_HEIGHT = GAME_HEIGHT * RENDER_SCALE;
export const TILE = 16;
