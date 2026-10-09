import assert from "node:assert/strict";
import { test } from "node:test";
import { CalcError, MAX, MIN, OPERATIONS, div, mul, sub, sum, type Operation } from "../src/calc.ts";

const DIVISION_BY_ZERO = "division_by_zero";
const OVERFLOW = "overflow";

// [operation, a, b, result or the outcome of the error it throws]
const CASES: [Operation, bigint, bigint, bigint | typeof DIVISION_BY_ZERO | typeof OVERFLOW][] = [
  // The worked example from the README.
  ["sum", 4n, 1n, 5n],
  ["sub", 4n, 1n, 3n],
  ["mul", 4n, 1n, 4n],
  ["div", 7n, 2n, 3n],
  // Truncation toward zero, both signs.
  ["div", -7n, 2n, -3n],
  ["div", 7n, -2n, -3n],
  ["div", -7n, -2n, 3n],
  ["div", 1n, 2n, 0n],
  ["div", -1n, 2n, 0n],
  // Zero and negatives behave like integers do.
  ["sum", -4n, 1n, -3n],
  ["sub", 1n, 4n, -3n],
  ["mul", -4n, 0n, 0n],
  ["div", 0n, 5n, 0n],
  // Division by zero.
  ["div", 1n, 0n, DIVISION_BY_ZERO],
  ["div", 0n, 0n, DIVISION_BY_ZERO],
  // Overflow in every operation. A bigint would happily grow past 64 bits.
  ["sum", MAX, 1n, OVERFLOW],
  ["sum", MIN, -1n, OVERFLOW],
  ["sub", MIN, 1n, OVERFLOW],
  ["sub", MAX, -1n, OVERFLOW],
  ["mul", MAX, 2n, OVERFLOW],
  ["mul", MIN, -1n, OVERFLOW],
  ["div", MIN, -1n, OVERFLOW],
  // The edges that do fit.
  ["sum", MAX, 0n, MAX],
  ["mul", MIN, 1n, MIN],
  ["div", MIN, 1n, MIN],
  ["div", MAX, -1n, -MAX],
];

test("results", () => {
  for (const [operation, a, b, want] of CASES) {
    const label = `${operation} ${a} ${b}`;
    if (typeof want === "bigint") {
      assert.equal(OPERATIONS[operation](a, b), want, label);
    } else {
      assert.throws(
        () => OPERATIONS[operation](a, b),
        (err) => err instanceof CalcError && err.outcome === want,
        label,
      );
    }
  }
});

test("the 64-bit range", () => {
  assert.equal(MAX, 9223372036854775807n);
  assert.equal(MIN, -9223372036854775808n);
});

test("the operations by name", () => {
  assert.deepEqual(Object.keys(OPERATIONS), ["sum", "sub", "mul", "div"]);
  assert.equal(OPERATIONS.sum, sum);
  assert.equal(OPERATIONS.sub, sub);
  assert.equal(OPERATIONS.mul, mul);
  assert.equal(OPERATIONS.div, div);
});

test("error text is what the API returns", () => {
  assert.equal(new CalcError("division_by_zero").message, "division by zero");
  assert.equal(new CalcError("overflow").message, "result does not fit in a 64-bit integer");
});
