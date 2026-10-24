// Deterministic pseudo-random numbers (mulberry32) so the demo is identical on every machine.
export function rng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    // Weighted pick from { key: weight } or [[key, weight]].
    weighted(weights) {
      const entries = Array.isArray(weights) ? weights : Object.entries(weights);
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [k, w] of entries) {
        x -= w;
        if (x < 0) return k;
      }
      return entries[entries.length - 1][0];
    },
    // Exponential with the given mean, rounded down.
    exp: (mean) => Math.floor(-Math.log(1 - next()) * mean),
    // Poisson-distributed count (Knuth for small means, normal approximation above 30).
    poisson(mean) {
      if (mean <= 0) return 0;
      if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * r.normal()));
      const L = Math.exp(-mean);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > L);
      return k - 1;
    },
    normal() {
      const u = 1 - next();
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
  return r;
}
