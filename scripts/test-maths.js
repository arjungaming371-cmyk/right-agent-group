#!/usr/bin/env node
/**
 * Regression tests for the maths engine: lib/maths.ts (ops arithmetic) and
 * the loan-math additions in lib/finance.ts (amortization schedule, flat→
 * reducing IRR conversion, prepayment savings + the prepayment/EMI/
 * eligibility/rate grounding builders).
 *
 * Why this suite exists: every rupee figure the AI quotes on a live call,
 * the website calculator shows, and the console assistant answers with
 * comes from this code. A wrong final balance or a misparsed lump sum is a
 * customer-visible lie, so the invariants (schedule closes at 0, principal
 * sums back exactly, flat-rate conversion monotonic, savings always between
 * 0 and remaining interest) are locked here.
 *
 * Run: node scripts/test-maths.js
 */
"use strict"
const { registerHooks } = require("node:module")

// finance.ts imports "./maths" extensionless (TS convention). Node's CJS
// resolver doesn't try .ts on its own — retry failed relative specifiers
// with the extension appended before giving up.
let registerOK = true
try {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (e) {
        if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js")) {
          return nextResolve(specifier + ".ts", context)
        }
        throw e
      }
    },
  })
} catch {
  registerOK = false
}

let maths, finance
try {
  maths = require("../lib/maths.ts")
  finance = require("../lib/finance.ts")
} catch (e) {
  console.error("cannot load TS directly:", e.message)
  process.exit(1)
}
if (!registerOK) console.log("note: resolve hook unavailable — direct-path loads used")

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name) } }
function near(name, actual, expected, tolPct) {
  const tol = Math.abs(expected) * (tolPct ?? 0.005)
  ok(name, Math.abs(actual - expected) <= tol)
}

// ────────────────────────── lib/maths.ts ──────────────────────────
console.log("── maths: clamp / roundTo / safeDivide ──")
ok("clamp in range", maths.clamp(5, 0, 10) === 5)
ok("clamp below → lo", maths.clamp(-3, 0, 10) === 0)
ok("clamp above → hi", maths.clamp(99, 0, 10) === 10)
ok("clamp NaN → lo", maths.clamp(NaN, 0, 10) === 0)
ok("roundTo 2dp", maths.roundTo(3.14159, 2) === 3.14)
ok("roundTo whole", maths.roundTo(2.5) === 3)
ok("roundTo NaN → 0", maths.roundTo(NaN, 2) === 0)
ok("safeDivide by zero → 0", maths.safeDivide(1, 0) === 0)
ok("safeDivide NaN denominator → 0", maths.safeDivide(5, NaN) === 0)
ok("safeDivide normal", maths.safeDivide(9, 4) === 2.25)

console.log("── maths: pctOf / rateOf / pctChange ──")
ok("pctOf basic", maths.pctOf(25, 200) === 12.5)
ok("pctOf zero whole → 0 (never NaN%)", maths.pctOf(10, 0) === 0)
ok("pctOf zero-zero → 0", maths.pctOf(0, 0) === 0)
ok("rateOf fraction", maths.rateOf(1, 4) === 0.25)
ok("pctChange increase", maths.pctChange(100, 118.5) === 18.5)
ok("pctChange decrease", maths.pctChange(200, 100) === -50)
ok("pctChange from zero → 100", maths.pctChange(0, 5) === 100)
ok("pctChange zero→zero → 0", maths.pctChange(0, 0) === 0)

console.log("── maths: mean / median / weightedAverage / formatPct ──")
ok("mean", maths.mean([1, 2, 3]) === 2)
ok("mean empty → 0", maths.mean([]) === 0)
ok("median odd", maths.median([1, 3, 2]) === 2)
ok("median even", maths.median([4, 1, 3, 2]) === 2.5)
ok("median empty → 0", maths.median([]) === 0)
near("weightedAverage", maths.weightedAverage([80, 90], [2, 1]), 83.333, 0.001)
ok("weightedAverage zero weights → 0", maths.weightedAverage([80, 90], [0, 0]) === 0)
ok("formatPct", maths.formatPct(12.45) === "12.5%")
ok("asPct", maths.asPct(0.254) === 25.4)

// ────────────────────────── lib/finance.ts — core EMI ──────────────────────────
console.log("── finance: calculateEMI / totals ──")
near("EMI 20L @7.25% 20y = ₹15,808", finance.calculateEMI(2000000, 7.25, 240), 15808, 0.001)
ok("EMI 0% rate → straight division", finance.calculateEMI(120000, 0, 12) === 10000)
ok("EMI zero principal → 0", finance.calculateEMI(0, 10, 12) === 0)
ok("EMI zero tenure → 0", finance.calculateEMI(100000, 10, 0) === 0)
ok("totalPayable", finance.totalPayable(15808, 240) === 15808 * 240)
ok("totalInterest floors at 0 (EMI below principal run-rate)", finance.totalInterest(120000, 5000, 12) === 0)

console.log("── finance: amortizationSchedule invariants ──")
const S = finance.amortizationSchedule(2000000, 7.25, 240)
ok("yearly rows = 20", S.yearly.length === 20)
ok("final balance exactly 0", S.yearly[S.yearly.length - 1].balance === 0)
near("principal sums back exactly", S.yearly.reduce((a, y) => a + y.principalPaid, 0), 2000000, 0.0001)
near("interest sums ≈ totalInterest", S.yearly.reduce((a, y) => a + y.interestPaid, 0), S.totalInterest, 0.0001)
ok("totalPayable = P + interest", S.totalPayable === 2000000 + S.totalInterest)
ok("EMI matches calculateEMI", S.emi === finance.calculateEMI(2000000, 7.25, 240))
ok("interest > 0 and < payable", S.totalInterest > 0 && S.totalInterest < S.totalPayable)
const S0 = finance.amortizationSchedule(120000, 0, 12)
ok("0% schedule closes at 0 with no interest", S0.yearly[S0.yearly.length - 1].balance === 0 && S0.totalInterest === 0)
const SHuge = finance.amortizationSchedule(1e15, 99, 9999)
ok("wild input clamped (≤480 months)", SHuge.yearly.length <= 40)

console.log("── finance: flatToReducingAPR (IRR bisection) ──")
const f12 = finance.flatToReducingAPR(12, 60)
ok("flat 12% 5y ≈ 20.31% reducing (known band 19–22)", f12 > 19 && f12 < 22)
near("flat 12% exact", f12, 20.31, 0.01)
ok("monotonic: 10 < 12 < 15 flat", finance.flatToReducingAPR(10, 60) < f12 && f12 < finance.flatToReducingAPR(15, 60))
ok("0% flat → 0% reducing", finance.flatToReducingAPR(0, 60) === 0)
// Shorter tenure → HIGHER reducing equivalent: with a flat rate you pay
// interest on money you have already repaid, and that penalty concentrates
// harder over short horizons (10% flat 3y ≈ 17.94% vs 5y ≈ 17.27%).
ok("shorter tenure → bigger gap (3y > 5y)", finance.flatToReducingAPR(12, 36) > finance.flatToReducingAPR(12, 60))
// Round-trip proof: the reducing rate that "matches" a flat rate must
// reproduce the flat-rate EMI through the standard annuity formula.
const rtP = 1000000
const rtN = 60
const rtFlatEmi = (rtP * (1 + 0.12 * (rtN / 12))) / rtN
const rtEmi = finance.calculateEMI(rtP, finance.flatToReducingAPR(12, rtN), rtN)
ok("round-trip: flat EMI ≡ reducing EMI (±2 rupees)", Math.abs(rtEmi - rtFlatEmi) <= 2)

console.log("── finance: prepaymentSavings ──")
const P = finance.prepaymentSavings(2000000, 7.25, 240, 500000, 24)
ok("savings positive", P.interestSaved > 0)
ok("tenure shortens", P.newMonths < 240)
ok("new interest < original", P.newInterest < P.originalInterest)
ok("saved = original − new", P.interestSaved === P.originalInterest - P.newInterest)
near("prepay 5L after 2y saves ≈ ₹8,95,451", P.interestSaved, 895451, 0.001)
ok("new tenure ≈ 152 months", P.newMonths >= 150 && P.newMonths <= 154)
const PClear = finance.prepaymentSavings(2000000, 7.25, 240, 2000000, 12)
ok("full prepay clears immediately", PClear.newMonths === 12 && PClear.newPayoffEmi === 0)
ok("full prepay saves the most", PClear.interestSaved > P.interestSaved)
const PTiny = finance.prepaymentSavings(2000000, 7.25, 240, 0, 24)
ok("zero prepay → zero savings", PTiny.interestSaved === 0)

console.log("── finance: eligibility (FOIR) ──")
near("₹1L income, no EMI → ≈ ₹73.3L eligible", finance.estimateMaxEligibleLoan(100000, 0, 7.25, 360), 7329484, 0.005)
ok("existing EMI shrinks eligibility", finance.estimateMaxEligibleLoan(100000, 40000, 7.25, 360) < finance.estimateMaxEligibleLoan(100000, 0, 7.25, 360))
ok("income fully consumed by EMI → 0", finance.estimateMaxEligibleLoan(100000, 60000, 7.25, 360) === 0)

console.log("── finance: parsers (regression locked) ──")
ok("parseAmount '20 lakh' → 2000000", finance.parseAmount("20 lakh loan") === 2000000)
ok("parseAmount '2.5 crore' → 25000000", finance.parseAmount("2.5 crore chahiye") === 25000000)
ok("parseAmount '50 thousand' → 50000", finance.parseAmount("50 thousand personal loan") === 50000)
ok("parseAmount '50k' → 50000", finance.parseAmount("50k loan") === 50000)
ok("parseAmount '₹18,50,000' → 1850000", finance.parseAmount("₹18,50,000") === 1850000)
ok("parseAmount no amount → null", finance.parseAmount("what is the process") === null)
ok("parseTenureMonths '20 years' → 240", finance.parseTenureMonths("for 20 years") === 240)
ok("parseTenureMonths none → null", finance.parseTenureMonths("emi entha") === null)

console.log("── finance: AI instruction builders ──")
const emiAns = finance.buildEmiInstruction("what is the EMI for 20 lakh home loan for 20 years", {})
ok("EMI question grounded", !!emiAns)
near("EMI answer uses real EMI", emiAns?.emi ?? 0, 15808, 0.01)
ok("EMI instruction states exact figure", (emiAns?.instruction || "").includes("15,808"))
// INCOME IS NOT PRINCIPAL: "salary 50k" must NOT price a ₹50k loan.
const trap = finance.buildEmiInstruction("my salary is 50k, what will be the EMI?", {})
ok("income framed → default principal (not 50k)", (trap?.principal ?? 0) === 2000000)
ok("income EMI far above a ₹50k-loan EMI", (trap?.emi ?? 0) > 5000)
// PREPAYMENT: quoted amount is the LUMP SUM, not the principal.
const preAns = finance.buildPrepaymentInstruction("if I prepay 5 lakh after 2 years what do I save", {})
ok("prepay question grounded", !!preAns)
ok("prepay: quoted 5L is the lump sum", preAns?.prepayAmount === 500000)
ok("prepay: principal defaults to 20L (not 5L)", preAns?.principal === 2000000)
ok("prepay instruction carries saving figure", (preAns?.instruction || "").includes("17,28,825"))
// "after 2 years" is TIMING, not tenure — both in one sentence must be
// parsed separately (the tenure bug used to price a 24-month loan here).
const preAns2 = finance.buildPrepaymentInstruction("I have a 20 year home loan, if I prepay 5 lakh after 2 years what do I save", {})
ok("timing vs tenure parsed separately", preAns2?.tenureMonths === 240 && preAns2?.afterMonths === 24)
near("20y tenure saving ≈ ₹8,95,451", preAns2?.interestSaved ?? 0, 895451, 0.001)
ok("non-prepay message → null", finance.buildPrepaymentInstruction("what is my EMI", {}) === null)
const rateAns = finance.buildRateInstruction("what is the interest rate for business loan", {})
ok("rate question grounded to BEST_RATES", (rateAns || "").includes("9%"))
const eligAns = finance.buildEligibilityInstruction("how much loan can I get, my monthly income is 80000", {})
ok("eligibility grounded", !!eligAns && eligAns.maxLoan > 0)
const eligAsk = finance.buildEligibilityInstruction("how much loan can I get?", {})
ok("eligibility without income → asks, never guesses", (eligAsk?.instruction || "").includes("ask"))
ok("random message grounds nothing", finance.buildEmiInstruction("hello hi good morning", {}) === null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
