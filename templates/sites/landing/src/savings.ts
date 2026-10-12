/**
 * The savings estimate behind "What could you save?": from a monthly
 * electricity bill, the plan that fits, roughly what it saves a month and
 * how long it takes to pay for itself. An estimate, and the page says so.
 */
export interface EstimatorPlan {
  name: string;
  price: number;
}

export interface EstimatorSettings {
  /** Bills up to these amounts suit the first, second, ... plan; above the last, the last plan. */
  billUpTo: number[];
  /** The share of the bill each plan typically saves (0.7 = 70%). */
  savingShare: number[];
}

export interface Estimate {
  plan: EstimatorPlan;
  monthlySaving: number;
  /** Years for the saving to cover the price; null when it saves too little to say. */
  paybackYears: number | null;
}

export function estimate(bill: number, plans: EstimatorPlan[], settings: EstimatorSettings): Estimate | null {
  if (plans.length === 0 || !(bill > 0)) return null;
  let index = settings.billUpTo.findIndex((limit) => bill <= limit);
  if (index === -1) index = plans.length - 1;
  index = Math.min(index, plans.length - 1);
  const plan = plans[index];
  const share = settings.savingShare[index] ?? settings.savingShare[settings.savingShare.length - 1] ?? 0;
  const monthlySaving = Math.round((bill * share) / 10) * 10;
  const yearly = monthlySaving * 12;
  const paybackYears = yearly >= 1000 ? Math.round((plan.price / yearly) * 10) / 10 : null;
  return { plan, monthlySaving, paybackYears };
}
