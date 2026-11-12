import { BUILTIN_BINDINGS } from "../evaluation/builtins.js";

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
