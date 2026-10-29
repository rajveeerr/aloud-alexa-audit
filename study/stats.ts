import { rng } from "./lib";

/** Ranks from 1, ties get the average of the ranks they span. */
export function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]![1]] = avg;
    i = j + 1;
  }
  return out;
}

export function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
}

export function spearman(x: number[], y: number[]): number {
  return pearson(ranks(x), ranks(y));
}

/** Spearman of x and y with z held fixed: the partial correlation of their ranks. */
export function partialSpearman(x: number[], y: number[], z: number[]): number {
  const rx = ranks(x);
  const ry = ranks(y);
  const rz = ranks(z);
  const xy = pearson(rx, ry);
  const xz = pearson(rx, rz);
  const yz = pearson(ry, rz);
  return (xy - xz * yz) / Math.sqrt((1 - xz * xz) * (1 - yz * yz));
}

export type Estimate = { n: number; rho: number; ci: [number, number]; p: number };

const BOOTSTRAP = 2000;
const PERMUTATIONS = 10000;

/**
 * A rank correlation with a percentile bootstrap 95% CI (pairs resampled) and a two-sided
 * permutation p-value (one variable shuffled against the rest). Both use fixed seeds.
 */
export function estimate(stat: (cols: number[][]) => number, cols: number[][], seed: number): Estimate {
  const n = cols[0]!.length;
  const rho = stat(cols);

  const draw = rng(seed);
  const boots: number[] = [];
  for (let b = 0; b < BOOTSTRAP; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(draw() * n));
    const r = stat(cols.map((c) => idx.map((i) => c[i]!)));
    if (Number.isFinite(r)) boots.push(r);
  }
  boots.sort((a, b) => a - b);
  const q = (p: number) => boots[Math.min(boots.length - 1, Math.floor(p * boots.length))]!;

  const shuffle = rng(seed + 1);
  let extreme = 0;
  for (let k = 0; k < PERMUTATIONS; k++) {
    const y = [...cols[1]!];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(shuffle() * (i + 1));
      [y[i], y[j]] = [y[j]!, y[i]!];
    }
    const r = stat([cols[0]!, y, ...cols.slice(2)]);
    if (Math.abs(r) >= Math.abs(rho) - 1e-12) extreme++;
  }

  return { n, rho, ci: [q(0.025), q(0.975)], p: (extreme + 1) / (PERMUTATIONS + 1) };
}

export const spearmanStat = (c: number[][]) => spearman(c[0]!, c[1]!);
export const partialStat = (c: number[][]) => partialSpearman(c[0]!, c[1]!, c[2]!);

export function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
