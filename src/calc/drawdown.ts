/**
 * Post-retirement portfolio drawdown simulation with tax-bucket tracking.
 */

import { ScenarioInputs, FilingStatus } from '../types';
import { marginalTax } from './tax';
import { requiredMinimumDistribution } from './rmd';

export const MAX_AGE = 95;
const SS_TAXABLE_FRACTION = 0.85;

export interface DrawdownResult {
  ages: number[];
  portfolioTotal: number[];
  pretax: number[];
  roth: number[];
  taxable: number[];
  spending: number[];
  ssIncome: number[];
  retirementIncome: number[];
  taxesPaid: number[];
  rmdAmounts: number[];
  depletionAge: number | null;
}

export function simulateDrawdown(
  inputs: ScenarioInputs,
  pretaxAtRetirement: number,
  rothAtRetirement: number,
  taxableAtRetirement: number,
  retirementAge: number,
  annualReturns?: number[],
): DrawdownResult {
  const years = MAX_AGE - retirementAge + 1;

  const ages: number[] = [];
  const pretax = new Array<number>(years).fill(0);
  const roth = new Array<number>(years).fill(0);
  const taxable = new Array<number>(years).fill(0);
  const portfolio = new Array<number>(years).fill(0);
  const spendingArr = new Array<number>(years).fill(0);
  const ssArr = new Array<number>(years).fill(0);
  const incomeArr = new Array<number>(years).fill(0);
  const taxesArr = new Array<number>(years).fill(0);
  const rmdArr = new Array<number>(years).fill(0);

  for (let i = 0; i < years; i++) ages.push(retirementAge + i);

  // Build one-time expense lookup {age: amount}
  const oneTime: Record<number, number> = {};
  for (const exp of inputs.one_time_expenses) {
    oneTime[exp.age] = (oneTime[exp.age] ?? 0) + exp.amount;
  }

  // Annual SS income (nominal at claiming time, fixed — no COLA)
  const ssAnnual = inputs.ss_monthly_benefit * 12 * ssFactor(inputs.ss_claiming_age);

  let depletionAge: number | null = null;
  const r = inputs.investment_return_rate;
  const yearsBeforeRetirement = retirementAge - inputs.current_age;

  // Track start-of-year balances (before growth and withdrawal)
  let prevPretax = pretaxAtRetirement;
  let prevRoth = rothAtRetirement;
  let prevTaxable = taxableAtRetirement;

  for (let i = 0; i < years; i++) {
    const age = ages[i];
    const yearsFromToday = yearsBeforeRetirement + i;
    const inflationFactor = Math.pow(1 + inputs.inflation_rate, yearsFromToday);

    let spending = inputs.desired_spending_today_dollars * inflationFactor;
    spending += inputs.healthcare_annual_bump * inflationFactor;
    spending += oneTime[age] ?? 0;
    spendingArr[i] = spending;

    const ss = age >= inputs.ss_claiming_age ? ssAnnual : 0;
    ssArr[i] = ss;

    let retIncome = 0;
    for (const stream of inputs.retirement_income_streams) {
      if (stream.start_age <= age && age <= stream.end_age) {
        retIncome += stream.amount; // nominal (like SS), no inflation adjustment
      }
    }
    incomeArr[i] = retIncome;

    const netNeeded = Math.max(spending - ss - retIncome, 0);

    const rmd = inputs.model_rmds
      ? requiredMinimumDistribution(prevPretax, age)
      : 0;
    rmdArr[i] = rmd;

    const annualR = annualReturns !== undefined ? annualReturns[i] : r;

    const pretaxAvail = prevPretax * (1 + annualR);
    const rothAvail = prevRoth * (1 + annualR);
    const taxableAvail = prevTaxable * (1 + annualR);

    const { pretaxDraw, rothDraw, taxableDraw, taxes, excessToTaxable } = fillWithdrawal(
      inputs.withdrawal_strategy,
      netNeeded,
      rmd,
      pretaxAvail,
      rothAvail,
      taxableAvail,
      ss,
      inputs.filing_status,
    );

    taxesArr[i] = taxes;

    pretax[i] = Math.max(pretaxAvail - pretaxDraw, 0);
    roth[i] = Math.max(rothAvail - rothDraw, 0);
    taxable[i] = Math.max(taxableAvail - taxableDraw + excessToTaxable, 0);
    portfolio[i] = pretax[i] + roth[i] + taxable[i];

    prevPretax = pretax[i];
    prevRoth = roth[i];
    prevTaxable = taxable[i];

    if (portfolio[i] <= 0 && (i === 0 || portfolio[i - 1] > 0)) {
      portfolio[i] = 0;
      depletionAge = age;
      // Zero out remaining years, keep projected spending
      for (let j = i + 1; j < years; j++) {
        portfolio[j] = 0;
        spendingArr[j] = spending;
        ssArr[j] = ss;
        incomeArr[j] = retIncome;
      }
      break;
    }
  }

  return {
    ages,
    portfolioTotal: portfolio,
    pretax,
    roth,
    taxable,
    spending: spendingArr,
    ssIncome: ssArr,
    retirementIncome: incomeArr,
    taxesPaid: taxesArr,
    rmdAmounts: rmdArr,
    depletionAge,
  };
}

interface WithdrawalResult {
  pretaxDraw: number;
  rothDraw: number;
  taxableDraw: number;
  taxes: number;
  excessToTaxable: number;
}

function fillWithdrawal(
  strategy: string,
  netNeeded: number,
  rmd: number,
  pretaxAvail: number,
  rothAvail: number,
  taxableAvail: number,
  ss: number,
  filingStatus: FilingStatus,
): WithdrawalResult {
  if (strategy === 'conventional') {
    return strategyConventional(netNeeded, rmd, pretaxAvail, rothAvail, taxableAvail, ss, filingStatus);
  } else if (strategy === 'roth_first') {
    return strategyRothFirst(netNeeded, rmd, pretaxAvail, rothAvail, taxableAvail, ss, filingStatus);
  } else {
    return strategyProportional(netNeeded, rmd, pretaxAvail, rothAvail, taxableAvail, ss, filingStatus);
  }
}

function strategyConventional(
  netNeeded: number, rmd: number,
  pretaxAvail: number, rothAvail: number, taxableAvail: number,
  ss: number, filingStatus: FilingStatus,
): WithdrawalResult {
  // Taxable → pre-tax → Roth
  const taxableDraw = Math.min(taxableAvail, netNeeded);
  const remaining = netNeeded - taxableDraw;

  let pretaxGrossForSpending = 0;
  if (remaining > 0 && pretaxAvail > 0) {
    pretaxGrossForSpending = grossUpPretax(remaining, ss, filingStatus).gross;
  }

  let pretaxDraw = Math.max(pretaxGrossForSpending, rmd);
  pretaxDraw = Math.min(pretaxDraw, pretaxAvail);

  const taxes = incrementalTax(pretaxDraw, ss, filingStatus);
  const pretaxNet = pretaxDraw - taxes;
  const excessToTaxable = Math.max(pretaxNet - remaining, 0);

  const netReceived = taxableDraw + pretaxNet - excessToTaxable;
  const rothDraw = Math.min(Math.max(netNeeded - netReceived, 0), rothAvail);

  return { pretaxDraw, rothDraw, taxableDraw, taxes, excessToTaxable };
}

function strategyRothFirst(
  netNeeded: number, rmd: number,
  pretaxAvail: number, rothAvail: number, taxableAvail: number,
  ss: number, filingStatus: FilingStatus,
): WithdrawalResult {
  // Roth → pre-tax → taxable
  const rothDraw = Math.min(rothAvail, netNeeded);
  const remaining = netNeeded - rothDraw;

  let pretaxGrossForSpending = 0;
  if (remaining > 0 && pretaxAvail > 0) {
    pretaxGrossForSpending = grossUpPretax(remaining, ss, filingStatus).gross;
  }

  let pretaxDraw = Math.max(pretaxGrossForSpending, rmd);
  pretaxDraw = Math.min(pretaxDraw, pretaxAvail);

  const taxes = incrementalTax(pretaxDraw, ss, filingStatus);
  const pretaxNet = pretaxDraw - taxes;
  const excessToTaxable = Math.max(pretaxNet - remaining, 0);

  const netReceived = rothDraw + pretaxNet - excessToTaxable;
  const taxableDraw = Math.min(Math.max(netNeeded - netReceived, 0), taxableAvail);

  return { pretaxDraw, rothDraw, taxableDraw, taxes, excessToTaxable };
}

function strategyProportional(
  netNeeded: number, rmd: number,
  pretaxAvail: number, rothAvail: number, taxableAvail: number,
  ss: number, filingStatus: FilingStatus,
): WithdrawalResult {
  const totalAvail = pretaxAvail + rothAvail + taxableAvail;
  if (totalAvail <= 0) {
    return { pretaxDraw: 0, rothDraw: 0, taxableDraw: 0, taxes: 0, excessToTaxable: 0 };
  }

  const pretaxFrac = pretaxAvail / totalAvail;
  const rothFrac = rothAvail / totalAvail;
  const taxableFrac = 1 - pretaxFrac - rothFrac;

  const netFromPretax = netNeeded * pretaxFrac;
  const netFromRoth = netNeeded * rothFrac;
  const netFromTaxable = netNeeded * taxableFrac;

  let pretaxGrossForSpending = 0;
  if (netFromPretax > 0 && pretaxAvail > 0) {
    pretaxGrossForSpending = grossUpPretax(netFromPretax, ss, filingStatus).gross;
  }

  let pretaxDraw = Math.max(pretaxGrossForSpending, rmd);
  pretaxDraw = Math.min(pretaxDraw, pretaxAvail);

  const taxes = incrementalTax(pretaxDraw, ss, filingStatus);
  const pretaxNet = pretaxDraw - taxes;
  const excessToTaxable = Math.max(pretaxNet - netFromPretax, 0);

  const rothDraw = Math.min(netFromRoth, rothAvail);
  const taxableDraw = Math.min(netFromTaxable, taxableAvail);

  return { pretaxDraw, rothDraw, taxableDraw, taxes, excessToTaxable };
}

function grossUpPretax(netNeeded: number, ssNominal: number, filingStatus: FilingStatus): { gross: number; taxes: number } {
  if (netNeeded <= 0) return { gross: 0, taxes: 0 };
  let gross = netNeeded;
  for (let i = 0; i < 6; i++) {
    const taxes = incrementalTax(gross, ssNominal, filingStatus);
    gross = netNeeded + taxes;
  }
  const taxes = incrementalTax(gross, ssNominal, filingStatus);
  return { gross, taxes };
}

function incrementalTax(pretaxGross: number, ssNominal: number, filingStatus: FilingStatus): number {
  const ssTaxable = ssNominal * SS_TAXABLE_FRACTION;
  return (
    marginalTax(pretaxGross + ssTaxable, filingStatus) -
    marginalTax(ssTaxable, filingStatus)
  );
}

function ssFactor(claimingAge: number): number {
  const factors: Record<number, number> = {
    62: 0.70, 63: 0.75, 64: 0.80, 65: 0.867,
    66: 0.933, 67: 1.00, 68: 1.08, 69: 1.16, 70: 1.24,
  };
  return factors[claimingAge] ?? 1.0;
}
