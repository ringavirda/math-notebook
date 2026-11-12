import { describe, expect, it } from "vitest";
import {
  analyze,
  builtins,
  EvalError,
  functionBinding,
  LexError,
  MathError,
  parse,
  ParseError,
  scopeOf,
  SemanticError,
  type Binding,
  type Definition,
  type Scope,
} from "../src/index.js";

const empty = scopeOf(new Map(), builtins);

function value(line: string, scope: Scope = empty): number {
  const parsed = parse(line);
  analyze(parsed, scope);
  return parsed.body.evaluate(scope);
}

function failure(line: string, scope: Scope = empty): MathError {
  try {
    value(line, scope);
  } catch (error) {
    if (error instanceof MathError) return error;
    throw error;
  }
  throw new Error(`${line} did not fail`);
}

describe("parse", () => {
  it.each([
    ["1+2*3", "1 + 2 * 3"],
    ["(1+2)*3", "(1 + 2) * 3"],
    ["1-(2-3)", "1 - (2 - 3)"],
    ["1-2-3", "1 - 2 - 3"],
    ["8/(2*2)", "8 / (2 * 2)"],
    ["2^3^2", "2 ^ 3 ^ 2"],
    ["(2^3)^2", "(2 ^ 3) ^ 2"],
    ["-2^2", "-2 ^ 2"],
    ["(-2)^2", "(-2) ^ 2"],
    ["-(2)^2", "-2 ^ 2"],
    ["2^-1", "2 ^ -1"],
    ["-(1+2)", "-(1 + 2)"],
    ["max(1, 2+3, f(4))", "max(1, 2 + 3, f(4))"],
    ["  .5 * 1e-3 ", "0.5 * 0.001"],
  ])("renders %j as %j", (line, rendered) => {
    expect(parse(line).body.toString()).toBe(rendered);
    expect(parse(parse(line).body.toString()).body.toString()).toBe(rendered);
  });

  it("tells definitions from expressions", () => {
    const variable = parse(" x = 1 + 2 ") as Definition;
    expect(variable).toMatchObject({
      kind: "definition",
      name: "x",
      params: [],
      source: "x = 1 + 2",
    });
    expect(variable.nameSpan).toEqual({ start: 1, end: 2 });
    const fn = parse("f(a, b) = a * b") as Definition;
    expect(fn).toMatchObject({
      kind: "definition",
      name: "f",
      params: ["a", "b"],
    });
    expect(parse("f(1)")).toMatchObject({ kind: "expression", source: "f(1)" });
  });

  it("spans an empty left side of '=' on the '=' token", () => {
    expect(() => parse("= 1")).toThrow(
      expect.objectContaining({ span: { start: 0, end: 1 } }),
    );
  });

  it("gives nodes their spans", () => {
    expect(parse("(1 + 2) * 3").body.span).toEqual({ start: 0, end: 11 });
    expect(parse("-x").body.span).toEqual({ start: 0, end: 2 });
    expect(parse("1 + max(2, 3)").body.span).toEqual({ start: 0, end: 13 });
  });

  it("collects names", () => {
    expect([...parse("f(x, 2) + y * sqrt(x)").body.names()].sort()).toEqual([
      "f",
      "sqrt",
      "x",
      "y",
    ]);
  });
});

describe("errors", () => {
  it.each([
    ["2 $ 3", LexError, "Unknown character '$'", 2, 3],
    ["1.2.3", LexError, "Malformed number '1.2.3'", 0, 5],
    ["1e999", LexError, "Number out of range '1e999'", 0, 5],
    ["(1+2", ParseError, "Missing ')'", 4, 4],
    ["f(1", ParseError, "Missing ')'", 3, 3],
    ["(1 2)", ParseError, "Missing ')'", 3, 4],
    ["1 +", ParseError, "Unexpected end of line", 3, 3],
    ["", ParseError, "Unexpected end of line", 0, 0],
    ["1 2", ParseError, "Unexpected '2'", 2, 3],
    ["* 2", ParseError, "Unexpected '*'", 0, 1],
    ["x = ", ParseError, "Unexpected end of line", 4, 4],
    ["x = 1 = 2", ParseError, "Unexpected '='", 6, 7],
    ["f(a,a)=a", ParseError, "Repeated parameter 'a'", 4, 5],
    ["f() = 1", ParseError, "A function needs at least one parameter", 1, 2],
    [
      "1 = 2",
      ParseError,
      "The left side of '=' must be a name or name(params)",
      0,
      2,
    ],
    [
      "f(1) = 2",
      ParseError,
      "The left side of '=' must be a name or name(params)",
      0,
      5,
    ],
    [
      "f(a b) = 1",
      ParseError,
      "The left side of '=' must be a name or name(params)",
      0,
      7,
    ],
    ["y + 1", SemanticError, "Unknown name 'y'", 0, 1],
    ["1 + g(2)", SemanticError, "Unknown function 'g'", 4, 8],
    ["sqrt(1,2)", SemanticError, "'sqrt' takes 1 argument, got 2", 0, 9],
    ["pi(2)", SemanticError, "'pi' is a variable, not a function", 0, 5],
    [
      "sqrt + 1",
      SemanticError,
      "'sqrt' is a function; call it as sqrt(...)",
      0,
      4,
    ],
    ["1/0", EvalError, "Division by zero", 0, 3],
    ["5 % 0", EvalError, "Division by zero", 0, 5],
    ["sqrt(-1)", EvalError, "sqrt of a negative number", 0, 8],
    ["ln(0)", EvalError, "ln of a non-positive number", 0, 5],
    ["log(-5)", EvalError, "log of a non-positive number", 0, 7],
    ["10^400", EvalError, "Result is not a finite number", 0, 6],
  ])("%j raises %o", (line, errorClass, message, start, end) => {
    const error = failure(line);
    expect(error).toBeInstanceOf(errorClass);
    expect(error).toBeInstanceOf(MathError);
    expect(error.message).toBe(message);
    expect(error.span).toEqual({ start, end });
  });

  it("names the stage of each class", () => {
    expect(
      [LexError, ParseError, SemanticError, EvalError].map(
        (c) => new c("m", { start: 0, end: 0 }).stage,
      ),
    ).toEqual(["lexical", "syntax", "semantic", "evaluation"]);
  });

  it("refuses to redefine a built-in at the name", () => {
    const line = parse("pi = 3");
    expect(() => analyze(line, empty)).toThrow(SemanticError);
    try {
      analyze(line, empty);
    } catch (error) {
      expect(error).toMatchObject({
        message: "Cannot redefine the built-in 'pi'",
        span: { start: 0, end: 2 },
      });
    }
    expect(() => analyze(parse("sqrt(x) = x"), empty)).toThrow(SemanticError);
  });
});

describe("evaluation", () => {
  it.each([
    ["1+2*3", 7],
    ["(1+2)*3", 9],
    ["2^3^2", 512],
    ["-2^2", -4],
    ["-(2)^2", -4],
    ["(-2)^2", 4],
    ["2^-1", 0.5],
    ["10 - 2 - 3", 5],
    ["7 % 4", 3],
    ["--3", 3],
    ["1e-3 * 1000", 1],
    ["min(3,1,2)", 1],
    ["max(3,1,2)", 3],
    ["min(5)", 5],
    ["log(1000)", 3],
    ["ln(e)", 1],
    ["round(2.5)", 3],
    ["abs(-4)", 4],
    ["sqrt(16)", 4],
    ["sin(0) + cos(0) + tan(0)", 1],
    ["pi", Math.PI],
  ])("%j = %d", (line, expected) => {
    expect(value(line)).toBeCloseTo(expected, 12);
  });

  it("looks names up in the scope and lets parameters shadow it", () => {
    const entries = new Map<string, Binding>([
      ["n", { kind: "value", value: 5 }],
    ]);
    const scope = scopeOf(entries, builtins);
    const definition = parse("f(n) = n * 2") as Definition;
    analyze(definition, scope);
    entries.set("f", functionBinding(definition, scope));
    expect(value("f(3)", scope)).toBe(6);
    expect(value("f(n)", scope)).toBe(10);
    expect(() => analyze(parse("f(1, 2)"), scope)).toThrow(
      "'f' takes 1 argument, got 2",
    );
  });

  it("reports a failure inside a user function at the call", () => {
    const entries = new Map<string, Binding>();
    const scope = scopeOf(entries, builtins);
    const definition = parse("inv(a) = 1 / a") as Definition;
    entries.set("inv", functionBinding(definition, scope));
    const error = failure("2 + inv(0)", scope);
    expect(error).toBeInstanceOf(EvalError);
    expect(error.message).toBe("In inv: Division by zero");
    expect(error.span).toEqual({ start: 4, end: 10 });
  });

  it("prefers the nearer scope", () => {
    const outer = scopeOf(
      new Map<string, Binding>([["x", { kind: "value", value: 1 }]]),
    );
    const inner = scopeOf(
      new Map<string, Binding>([["x", { kind: "value", value: 2 }]]),
      outer,
    );
    expect(inner.lookup("x")).toEqual({ kind: "value", value: 2 });
    expect(outer.lookup("y")).toBeUndefined();
  });
});
