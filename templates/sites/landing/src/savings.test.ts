import { describe, expect, it } from "vitest";

import { estimate } from "./savings";

const plans = [
  { name: "Backup", price: 38500 },
  { name: "Hybrid", price: 89000 },
  { name: "Off-grid ready", price: 165000 }
];
const settings = { billUpTo: [1500, 4500], savingShare: [0.15, 0.7, 0.85] };

describe("savings estimate", () => {
  it("fits the plan to the bill", () => {
    expect(estimate(1200, plans, settings)?.plan.name).toBe("Backup");
    expect(estimate(3200, plans, settings)?.plan.name).toBe("Hybrid");
    expect(estimate(9000, plans, settings)?.plan.name).toBe("Off-grid ready");
  });

  it("says what it saves and when it pays for itself", () => {
    const result = estimate(3200, plans, settings)!;
    expect(result.monthlySaving).toBe(2240);
    expect(result.paybackYears).toBeCloseTo(3.3, 1);
  });

  it("does not promise a payback it cannot show", () => {
    expect(estimate(300, plans, settings)?.paybackYears).toBeNull();
    expect(estimate(0, plans, settings)).toBeNull();
    expect(estimate(2000, [], settings)).toBeNull();
  });
});
