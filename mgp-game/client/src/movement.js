// Tuning del movimiento. Gravedad base del mundo: 1400. (El grafo del bot lo usa para simular saltos.)
export const MOVE = {
  maxSpeed: 280,
  groundAccel: 2600,
  airAccel: 1600,
  groundDrag: 2200,
  airDrag: 500,
  jumpVelocity: 620, // ~137 px de altura: alcanza la plataforma central alta
  jumpCut: 0.45, // al soltar el salto antes de la cima
  fallGravity: 700, // gravedad extra al caer: salto menos "flotante"
  fastFallGravity: 2200,
  fastFallSpeed: 650,
  maxFall: 950,
  coyoteMs: 90,
  jumpBufferMs: 110,
  dropThroughMs: 250,
  impulseLockMs: 300, // tras un retroceso/explosión no se aplica la caída rápida
  // Pared: empujando contra ella en el aire se resbala despacio; con salto se rebota hacia fuera.
  wallSlideSpeed: 130,
  wallJumpVx: 330,
  wallJumpVy: 560,
  wallCoyoteMs: 100, // se puede saltar un poco después de soltarse de la pared
  wallJumpLockMs: 160, // tras rebotar, sin control horizontal (si no, se vuelve a pegar)
};
