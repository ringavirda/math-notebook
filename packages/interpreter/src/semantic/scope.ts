/** What a name stands for: a number, or a callable with a fixed or variadic argument count. */
export type Binding =
  | { kind: "value"; value: number }
  | {
      kind: "function";
      arity: number | "variadic";
      call(args: readonly number[]): number;
    };

/** A name table that may defer to an enclosing one. */
export interface Scope {
  lookup(name: string): Binding | undefined;
}

/** Thrown by a callable that cannot compute a result for its arguments; the call node turns it into an `EvalError`. */
export class DomainFault extends Error {}

function fn(
  arity: number | "variadic",
  call: (args: readonly number[]) => number,
): Binding {
  return { kind: "function", arity, call };
}

function value(number: number): Binding {
  return { kind: "value", value: number };
}

const BUILTIN_BINDINGS: ReadonlyMap<string, Binding> = new Map<string, Binding>(
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

/**
 * Builds a scope from a name table.
 * @param entries the names bound here.
 * @param parent consulted for names missing from `entries`.
 */
export function scopeOf(
  entries: ReadonlyMap<string, Binding>,
  parent?: Scope,
): Scope {
  return {
    lookup: (name) => entries.get(name) ?? parent?.lookup(name),
  };
}

/** The constants `pi`, `e` and the functions `sqrt abs sin cos tan ln log min max round`. */
export const builtins: Scope = scopeOf(BUILTIN_BINDINGS);

/** @returns whether `name` is a built-in constant or function. */
export function isBuiltin(name: string): boolean {
  return BUILTIN_BINDINGS.has(name);
}
