/**
 * Monte Carlo simulation for drawdown phase.
 * Uses Box-Muller transform for log-normal return sampling (no external library).
 */

import { ScenarioInputs } from '../types';
import { simulateDrawdown, MAX_AGE } from './drawdown';

export interface MonteCarloResult {
  successRate: number;
  p10: number[];
  p50: number[];
  p90: number[];
}

/** Box-Muller transform: standard normal sample from two uniform [0,1] values. */
function standardNormal(): number {
  let u1: number, u2: number;
  do { u1 = Math.random(); } while (u1 === 0);
  u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Log-normal sample: exp(mu + sigma * Z) - 1 (as a return rate). */
function logNormalReturn(mu: number, sigma: number): number {
  return Math.exp(mu + sigma * standardNormal()) - 1;
}

/** Compute percentile of a sorted array (linear interpolation). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function runMonteCarlo(
  inputs: ScenarioInputs,
  pretaxAtRetirement: number,
  rothAtRetirement: number,
  taxableAtRetirement: number,
  retirementAge: number,
): MonteCarloResult {
  // Guard: if already at or past MAX_AGE there's nothing to simulate
  if (retirementAge >= MAX_AGE) {
    const startBalance = pretaxAtRetirement + rothAtRetirement + taxableAtRetirement;
    return { successRate: 1.0, p10: [startBalance], p50: [startBalance], p90: [startBalance] };
  }

  const n = inputs.monte_carlo_simulations;
  const years = MAX_AGE - retirementAge + 1;

  // Log-normal parameters: E[r] = return_rate, std = monte_carlo_std
  const mu = Math.log(1 + inputs.investment_return_rate) - 0.5 * inputs.monte_carlo_std ** 2;
  const sigma = inputs.monte_carlo_std;

  // allPaths[year][sim] — we'll transpose for percentile calc
  const allPaths: number[][] = Array.from({ length: years }, () => new Array<number>(n).fill(0));
  let successes = 0;

  for (let i = 0; i < n; i++) {
    const annualReturns: number[] = [];
    for (let y = 0; y < years; y++) {
      annualReturns.push(logNormalReturn(mu, sigma));
    }

    const result = simulateDrawdown(
      inputs,
      pretaxAtRetirement,
      rothAtRetirement,
      taxableAtRetirement,
      retirementAge,
      annualReturns,
    );

    for (let y = 0; y < years; y++) {
      allPaths[y][i] = result.portfolioTotal[y];
    }
    if (result.depletionAge === null) successes++;
  }

  const successRate = successes / n;

  // Compute percentiles year-by-year
  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];

  for (let y = 0; y < years; y++) {
    const sorted = [...allPaths[y]].sort((a, b) => a - b);
    p10.push(percentile(sorted, 10));
    p50.push(percentile(sorted, 50));
    p90.push(percentile(sorted, 90));
  }

  return { successRate, p10, p50, p90 };
}
