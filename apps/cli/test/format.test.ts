import { describe, expect, it } from "vitest";
import { EvalError, LexError, ParseError } from "@mathbook/interpreter";
import { DomainError } from "@mathbook/notebook";
import {
  describeError,
  formatDefinition,
  formatNumber,
  formatRecord,
  formatResult,
} from "../src/format.js";

describe("formatNumber", () => {
  it.each([
    [3, "3"],
    [0.1 + 0.2, "0.3"],
    [1 / 3, "0.333333333333"],
    [144.00000000000003, "144"],
    [-2.5, "-2.5"],
    [1234567.891234567, "1234567.89123"],
    [0, "0"],
    [-0, "0"],
  ])("%s prints as %s", (value, text) => {
    expect(formatNumber(value)).toBe(text);
  });
});

describe("formatDefinition", () => {
  it("prints a variable with its value", () => {
    expect(
      formatDefinition({
        name: "rate",
        params: [],
        source: "rate = 0.2",
        value: 0.2,
        dependsOn: [],
      }),
    ).toBe("rate = 0.2");
  });

  it("prints a function with its parameters and body", () => {
    expect(
      formatDefinition({
        name: "total",
        params: ["n", "m"],
        source: "total(n,m)=n*price",
        dependsOn: ["price"],
      }),
    ).toBe("total(n, m) = n * price");
  });
});

describe("formatResult", () => {
  it("prints an expression value", () => {
    expect(
      formatResult({ kind: "expression", source: "1 + 2", value: 3 }),
    ).toEqual(["3"]);
  });

  it("indents each recomputed variable under the definition", () => {
    expect(
      formatResult({
        kind: "definition",
        source: "price = 50",
        definition: {
          name: "price",
          params: [],
          source: "price = 50",
          value: 50,
          dependsOn: [],
        },
        recomputed: [
          { name: "subtotal", value: 100 },
          { name: "tax", value: 20 },
        ],
      }),
    ).toEqual(["price = 50", "  subtotal = 100", "  tax = 20"]);
  });
});

describe("describeError", () => {
  it("draws the caret under the span", () => {
    expect(
      describeError(
        new ParseError("Unexpected '*'", { start: 4, end: 5 }),
        "1 + * 2",
      ),
    ).toEqual(["Syntax error: Unexpected '*'", "1 + * 2", "    ^"]);
  });

  it("widens the caret over the span", () => {
    expect(
      describeError(
        new LexError("Unknown character", { start: 2, end: 5 }),
        "a $$$",
      ),
    ).toEqual(["Lexical error: Unknown character", "a $$$", "  ^^^"]);
  });

  it("keeps one caret for an empty span", () => {
    expect(
      describeError(
        new EvalError("Result is not a finite number", { start: 3, end: 3 }),
        "1 +",
      ),
    ).toEqual([
      "Evaluation error: Result is not a finite number",
      "1 +",
      "   ^",
    ]);
  });

  it("prints only the message of a domain error", () => {
    expect(describeError(new DomainError("Cannot remove"), "x")).toEqual([
      "Cannot remove",
    ]);
  });
});

describe("formatRecord", () => {
  const at = new Date("2026-11-12T10:20:30.456Z");
  const base = { notebook: "main", at, kind: "expression" as const };

  it("prints a value", () => {
    expect(
      formatRecord({ ...base, source: "1 + 2", result: 3, error: null }),
    ).toBe("2026-11-12 10:20:30 1 + 2 => 3");
  });

  it("prints a definition without a value as defined", () => {
    expect(
      formatRecord({
        ...base,
        source: "f(n) = n",
        kind: "definition",
        result: null,
        error: null,
      }),
    ).toBe("2026-11-12 10:20:30 f(n) = n => defined");
  });

  it("prints a math failure with its stage and a domain failure plain", () => {
    expect(
      formatRecord({
        ...base,
        source: "1 +",
        result: null,
        error: { stage: "syntax", message: "Unexpected end" },
      }),
    ).toBe("2026-11-12 10:20:30 1 + => Syntax error: Unexpected end");
    expect(
      formatRecord({
        ...base,
        source: "x = 0",
        result: null,
        error: { stage: "domain", message: "Cannot change x" },
      }),
    ).toBe("2026-11-12 10:20:30 x = 0 => Cannot change x");
  });
});
