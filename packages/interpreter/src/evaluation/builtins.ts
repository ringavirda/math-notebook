import type { Binding } from "../semantic/scope.js";

/** Thrown by a callable that cannot compute a result for its arguments; the call node turns it into an `EvalError`. */
export class DomainFault extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

function fn(
  arity: number | "variadic",
  call: (args: readonly number[]) => number,
): Binding {
  return { kind: "function", arity, call };
}

function value(number: number): Binding {
  return { kind: "value", value: number };
}

/** The built-in constants and functions by name. */
export const BUILTIN_BINDINGS: ReadonlyMap<string, Binding> = new Map<string, Binding>(
  [
    ["pi", value(Math.PI)],
    ["e", value(Math.E)],
    [
      "sqrt",
      fn(1, ([x]) => {
        if (x < 0) throw new DomainFault("sqrt of a negative number");
        return Math.sqrt(x);
      }),
    ],
    ["abs", fn(1, ([x]) => Math.abs(x))],
    ["sin", fn(1, ([x]) => Math.sin(x))],
    ["cos", fn(1, ([x]) => Math.cos(x))],
    ["tan", fn(1, ([x]) => Math.tan(x))],
    [
      "ln",
      fn(1, ([x]) => {
        if (x <= 0) throw new DomainFault("ln of a non-positive number");
        return Math.log(x);
      }),
    ],
    [
      "log",
      fn(1, ([x]) => {
        if (x <= 0) throw new DomainFault("log of a non-positive number");
        return Math.log10(x);
      }),
    ],
    ["min", fn("variadic", (args) => Math.min(...args))],
    ["max", fn("variadic", (args) => Math.max(...args))],
    ["round", fn(1, ([x]) => Math.round(x))],
  ],
);
