// Telemetría de partidas en memoria: cada partida terminada (o sembrada por /api/test/seed) suma a
// unos acumulados, así GET /api/test/telemetry responde en O(jugadores) sin recorrer las partidas.
const MAX_MATCHES = 20000; // tope de memoria: se descartan las más antiguas (los acumulados se quedan)
const LATENCY_WINDOW = 1000; // últimas medidas de ping/pong para la mediana y el p95
const NAMES = ['NEO', 'TRINITY', 'GLITCH', 'CIPHER', 'NOVA', 'BYTE', 'VOLT', 'ROGUE', 'PIXEL', 'ZERO', 'ECHO', 'RAZOR', 'SPARK', 'DRIFT', 'HEX', 'ORBIT', 'BLAZE', 'FROST', 'VIPER', 'ATLAS'];

export default class Telemetry {
  constructor() {
    this.reset();
  }

  reset() {
    this.matches = [];
    this.totals = { matches: 0, rounds: 0, durationMs: 0, kills: 0, deaths: 0, survivalMs: 0, survivalSamples: 0, sideWins: [0, 0] };
    this.byName = new Map(); // nombre -> { matches, wins, kills, deaths }
    this.latency = { sum: 0, samples: 0, max: 0, recent: [] };
  }

  // match: { players: [{ name, kills, deaths, won, survivalMs }, x2], rounds, durationMs, at? }
  record(match) {
    const m = { ...match, at: match.at ?? Date.now() };
    this.matches.push(m);
    if (this.matches.length > MAX_MATCHES) this.matches.shift();
    const t = this.totals;
    t.matches++;
    t.rounds += m.rounds;
    t.durationMs += m.durationMs;
    m.players.forEach((p, side) => {
      t.kills += p.kills;
      t.deaths += p.deaths;
      t.survivalMs += p.survivalMs;
      t.survivalSamples += m.rounds;
      if (p.won) t.sideWins[side]++;
      const s = this.byName.get(p.name) ?? { matches: 0, wins: 0, kills: 0, deaths: 0 };
      s.matches++;
      s.wins += p.won ? 1 : 0;
      s.kills += p.kills;
      s.deaths += p.deaths;
      this.byName.set(p.name, s);
    });
  }

  recordLatency(ms) {
    const l = this.latency;
    l.sum += ms;
    l.samples++;
    l.max = Math.max(l.max, ms);
    l.recent.push(ms);
    if (l.recent.length > LATENCY_WINDOW) l.recent.shift();
  }

  // Ping/pong: media y máximo históricos; mediana, p95 y % bajo 100 ms de las últimas medidas.
  latencySummary() {
    const l = this.latency;
    const sorted = [...l.recent].sort((a, b) => a - b);
    const pct = (q) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]) : 0);
    return {
      avgMs: Math.round(l.samples ? l.sum / l.samples : 0),
      p50Ms: pct(0.5),
      p95Ms: pct(0.95),
      maxMs: Math.round(l.max),
      under100msPct: sorted.length ? +((sorted.filter((ms) => ms < 100).length / sorted.length) * 100).toFixed(1) : 0,
      samples: l.samples,
    };
  }

  // Métricas agregadas: tasa de victoria (por lado y por jugador), KDR y supervivencia media por ronda.
  summary(live = {}) {
    const t0 = performance.now();
    const t = this.totals;
    const ratio = (a, b) => (b ? +(a / b).toFixed(3) : 0);
    const kdr = (k, d) => +(k / Math.max(1, d)).toFixed(2);
    const top = [...this.byName.entries()]
      .map(([name, s]) => ({ name, matches: s.matches, wins: s.wins, winRate: ratio(s.wins, s.matches), kdr: kdr(s.kills, s.deaths) }))
      .sort((a, b) => b.winRate - a.winRate || b.matches - a.matches)
      .slice(0, 10);
    return {
      matches: t.matches,
      rounds: t.rounds,
      winRate: { player1: ratio(t.sideWins[0], t.matches), player2: ratio(t.sideWins[1], t.matches) },
      kdr: kdr(t.kills, t.deaths),
      avgSurvivalMs: Math.round(t.survivalSamples ? t.survivalMs / t.survivalSamples : 0),
      avgMatchDurationMs: Math.round(t.matches ? t.durationMs / t.matches : 0),
      avgRoundsPerMatch: ratio(t.rounds, t.matches),
      topPlayers: top,
      latency: this.latencySummary(),
      live,
      computedInMs: +(performance.now() - t0).toFixed(3),
    };
  }

  // Partidas de prueba reproducibles (mismo `seed` = mismas partidas).
  seed(count, seed = 12345) {
    let s = seed >>> 0 || 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    for (let i = 0; i < count; i++) {
      const winner = rnd() < 0.5 ? 0 : 1;
      const loserWins = Math.floor(rnd() * 5);
      const rounds = 5 + loserWins + Math.floor(rnd() * 2); // con algún empate
      const roundMs = 6000 + rnd() * 20000;
      const names = [pick(NAMES), pick(NAMES)];
      const players = [0, 1].map((side) => {
        const wins = side === winner ? 5 : loserWins;
        const deaths = side === winner ? loserWins : 5;
        return { name: names[side], kills: wins, deaths, won: side === winner, survivalMs: Math.round(roundMs * rounds * (side === winner ? 0.95 : 0.8)) };
      });
      this.record({ players, rounds, durationMs: Math.round(roundMs * rounds), at: Date.now() - Math.floor(rnd() * 7 * 864e5) });
    }
    return count;
  }
}
