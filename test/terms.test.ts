import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX, MIN } from "../src/calc.ts";
import { InvalidTerm, parseTerms } from "../src/terms.ts";

function invalid(message: string, query: string): void {
  assert.throws(() => parseTerms(query), (err) => err instanceof InvalidTerm && err.message === message, query);
}

test("parses both terms", () => {
  assert.deepEqual(parseTerms("term_one=4&term_two=1"), [4n, 1n]);
  assert.deepEqual(parseTerms("term_two=1&term_one=4"), [4n, 1n]);
  assert.deepEqual(parseTerms("term_one=0&term_two=0&extra=ignored"), [0n, 0n]);
  assert.deepEqual(parseTerms("term_one=9223372036854775807&term_two=-9223372036854775808"), [MAX, MIN]);
});

test("a plus sign travels as %2B; a bare + is a space", () => {
  assert.deepEqual(parseTerms("term_one=-7&term_two=%2B2"), [-7n, 2n]);
  invalid('term_two must be an integer, got " 2"', "term_one=-7&term_two=+2");
});

test("leading zeros are decimal", () => {
  assert.deepEqual(parseTerms("term_one=010&term_two=0008"), [10n, 8n]);
});

test("repeated keys take the last value", () => {
  assert.deepEqual(parseTerms("term_one=1&term_one=2&term_two=3"), [2n, 3n]);
});

test("missing terms", () => {
  invalid("term_one is required", "");
  invalid("term_one is required", "term_two=1");
  invalid("term_two is required", "term_one=1");
  invalid("term_one is required", "term_one[]=1&term_two=1");
});

test("non-integers", () => {
  invalid('term_one must be an integer, got "abc"', "term_one=abc&term_two=1");
  invalid('term_two must be an integer, got "1.5"', "term_one=1&term_two=1.5");
  invalid('term_one must be an integer, got ""', "term_one=&term_two=1");
  invalid('term_one must be an integer, got ""', "term_one&term_two=1");
  invalid('term_one must be an integer, got " 1"', "term_one=%201&term_two=1");
  invalid('term_two must be an integer, got "-"', "term_one=1&term_two=-");
  // What BigInt() and Number() would accept and the API does not.
  invalid('term_one must be an integer, got "0x1f"', "term_one=0x1f&term_two=1");
  invalid('term_one must be an integer, got "1e3"', "term_one=1e3&term_two=1");
  invalid('term_one must be an integer, got "1n"', "term_one=1n&term_two=1");
  invalid('term_one must be an integer, got "1\\n"', "term_one=1%0A&term_two=1");
  invalid('term_one must be an integer, got "١"', "term_one=%D9%A1&term_two=1");
});

test("the quoted value is escaped like a JSON string", () => {
  invalid('term_one must be an integer, got "a\\"b${c}"', "term_one=a%22b%24%7Bc%7D&term_two=1");
});

test("bytes that are not UTF-8 become U+FFFD", () => {
  invalid('term_one must be an integer, got "�"', "term_one=%ff&term_two=1");
});

test("integers that do not fit say so", () => {
  invalid(
    'term_one does not fit in a 64-bit integer, got "9223372036854775808"',
    "term_one=9223372036854775808&term_two=1",
  );
  invalid(
    'term_two does not fit in a 64-bit integer, got "-99999999999999999999"',
    "term_one=1&term_two=-99999999999999999999",
  );
});

test("the first problem wins", () => {
  invalid('term_one must be an integer, got "x"', "term_one=x&term_two=y");
});
