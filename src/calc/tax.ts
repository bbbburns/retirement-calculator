/**
 * Federal income tax bracket calculations (2025 rates).
 * Update TAX_YEAR and all bracket/deduction values each January.
 */

import { FilingStatus } from '../types';

export const TAX_YEAR = 2025;

// Structure: [upperThreshold, rate] — threshold is cumulative taxable income ceiling
const BRACKETS: Record<FilingStatus, [number, number][]> = {
  mfj: [
    [23_850, 0.10],
    [96_950, 0.12],
    [206_700, 0.22],
    [394_600, 0.24],
    [501_050, 0.32],
    [751_600, 0.35],
    [Infinity, 0.37],
  ],
  single: [
    [11_925, 0.10],
    [48_475, 0.12],
    [103_350, 0.22],
    [197_300, 0.24],
    [250_525, 0.32],
    [626_350, 0.35],
    [Infinity, 0.37],
  ],
  hoh: [
    [17_000, 0.10],
    [64_850, 0.12],
    [103_350, 0.22],
    [197_300, 0.24],
    [250_500, 0.32],
    [626_350, 0.35],
    [Infinity, 0.37],
  ],
};

const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  mfj: 30_000,
  single: 15_000,
  hoh: 22_500,
};

export function marginalTax(grossOrdinaryIncome: number, filingStatus: FilingStatus = 'mfj'): number {
  const stdDed = STANDARD_DEDUCTION[filingStatus] ?? STANDARD_DEDUCTION.mfj;
  let taxable = Math.max(grossOrdinaryIncome - stdDed, 0);
  if (taxable === 0) return 0;

  const brackets = BRACKETS[filingStatus] ?? BRACKETS.mfj;
  let tax = 0;
  let prevUpper = 0;

  for (const [upper, rate] of brackets) {
    if (taxable <= 0) break;
    const inBracket = Math.min(taxable, upper - prevUpper);
    tax += inBracket * rate;
    taxable -= inBracket;
    prevUpper = upper;
  }

  return tax;
}

export function effectiveRate(grossOrdinaryIncome: number, filingStatus: FilingStatus = 'mfj'): number {
  if (grossOrdinaryIncome <= 0) return 0;
  return marginalTax(grossOrdinaryIncome, filingStatus) / grossOrdinaryIncome;
}
