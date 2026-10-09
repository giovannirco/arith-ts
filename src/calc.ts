// The four operations on signed 64-bit integers. No HTTP in here.
//
// JavaScript numbers are doubles and lose integers past 2^53, so every term
// and result is a bigint, and every result is checked against the 64-bit
// range: a result that does not fit is an error, not a bigger number.
//
// To add or change an operation: edit its function, add rows to the table in
// test/calc.test.ts, add it to OPERATIONS, and give the page a button in
// web/index.html. The route comes from OPERATIONS.

export const MIN = -(2n ** 63n);
export const MAX = 2n ** 63n - 1n;

// How a call to /api/<op> ended; also the label on arith_operations_total.
export type Outcome = "ok" | "bad_input" | "division_by_zero" | "overflow";

// Why an operation could not produce an integer. The message is what the API
// returns.
export class CalcError extends Error {
  readonly outcome: Outcome;

  constructor(outcome: "division_by_zero" | "overflow") {
    super(outcome === "division_by_zero" ? "division by zero" : "result does not fit in a 64-bit integer");
    this.outcome = outcome;
  }
}

function fit(n: bigint): bigint {
  if (n < MIN || n > MAX) throw new CalcError("overflow");
  return n;
}

export const sum = (a: bigint, b: bigint): bigint => fit(a + b);

export const sub = (a: bigint, b: bigint): bigint => fit(a - b);

export const mul = (a: bigint, b: bigint): bigint => fit(a * b);

// Integer division, truncating toward zero: 7 / 2 = 3, -7 / 2 = -3. That is
// what bigint division already does. MIN / -1 is the one quotient that does
// not fit.
export function div(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new CalcError("division_by_zero");
  return fit(a / b);
}

// The path segment under /api/ for each operation.
export const OPERATIONS = { sum, sub, mul, div } as const;

export type Operation = keyof typeof OPERATIONS;
