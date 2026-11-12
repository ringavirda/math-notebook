import type { Definition } from "../syntax/parser.js";
import { type Binding, type Scope, scopeOf } from "../semantic/scope.js";

/**
 * Makes a user function callable.
 * @param definition a function definition (one or more parameters).
 * @param scope where the body finds its free names; consulted at call time, so later changes to it are seen.
 * @returns a function binding whose arity is the parameter count; parameters shadow `scope`.
 */
export function functionBinding(definition: Definition, scope: Scope): Binding {
  return {
    kind: "function",
    arity: definition.params.length,
    call(args) {
      const locals = new Map<string, Binding>(
        definition.params.map((param, i) => [
          param,
          { kind: "value", value: args[i] },
        ]),
      );
      return definition.body.evaluate(scopeOf(locals, scope));
    },
  };
}
