// Reads term_one and term_two from a raw query string.
//
// The query is parsed here rather than by Fastify so that every malformed
// request still gets the same {"error": ...} shape, and so the message can
// quote exactly what was sent.

import { MAX, MIN } from "./calc.ts";

// An error the client can fix. The message is the API's error text.
export class InvalidTerm extends Error {}

// An optional sign followed by ASCII digits.
const INTEGER = /^[+-]?[0-9]+$/;

// Returns [term_one, term_two], or throws InvalidTerm for the first term that
// is missing or unusable.
//
// URLSearchParams decodes application/x-www-form-urlencoded: + is a space,
// %XX is a byte, bytes that are not UTF-8 become U+FFFD. A key that repeats
// keeps its last value; other keys are ignored.
export function parseTerms(query: string): [bigint, bigint] {
  const params = new URLSearchParams(query);
  return [term("term_one", params.getAll("term_one").at(-1)), term("term_two", params.getAll("term_two").at(-1))];
}

function term(name: string, value: string | undefined): bigint {
  if (value === undefined) throw new InvalidTerm(`${name} is required`);
  if (!INTEGER.test(value)) throw new InvalidTerm(`${name} must be an integer, got ${JSON.stringify(value)}`);
  const n = BigInt(value);
  if (n < MIN || n > MAX) {
    throw new InvalidTerm(`${name} does not fit in a 64-bit integer, got ${JSON.stringify(value)}`);
  }
  return n;
}
