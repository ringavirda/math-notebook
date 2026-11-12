import {
  analyze,
  builtins,
  functionBinding,
  MathError,
  parse,
  scopeOf,
  SemanticError,
  type Binding,
  type Definition,
  type Line,
  type Scope,
} from "@mathbook/interpreter";
import { DependencyError, NotFoundError, StorageError } from "./errors.js";

/** A stored definition as the outside world sees it. */
export interface DefinitionView {
  name: string;
  params: readonly string[];
  source: string;
  /** Present for a variable only. */
  value?: number;
  /** The notebook's definitions the body mentions, in order of appearance. */
  dependsOn: readonly string[];
}

/** What one line did. */
export type RunResult =
  | { kind: "expression"; source: string; value: number }
  | {
      kind: "definition";
      source: string;
      definition: DefinitionView;
      recomputed: readonly { name: string; value: number }[];
    };

type Definitions = ReadonlyMap<string, Definition>;
type Values = ReadonlyMap<string, number>;

function scopeOver(definitions: Definitions, values: Values): Scope {
  const bindings = new Map<string, Binding>();
  const scope = scopeOf(bindings, builtins);
  for (const [name, definition] of definitions) {
    bindings.set(
      name,
      definition.params.length === 0
        ? { kind: "value", value: values.get(name) ?? 0 }
        : functionBinding(definition, scope),
    );
  }
  return scope;
}

function directDependencies(
  definitions: Definitions,
  definition: Definition,
): string[] {
  return [...definition.body.names()].filter(
    (name) => !definition.params.includes(name) && definitions.has(name),
  );
}

/** Every name of `definitions`, each after the names it uses. A cycle is cut where it closes. */
function dependencyOrder(definitions: Definitions): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const used of directDependencies(
      definitions,
      definitions.get(name)!,
    )) {
      visit(used);
    }
    order.push(name);
  };
  for (const name of definitions.keys()) visit(name);
  return order;
}

function reachable(
  start: string,
  next: (name: string) => Iterable<string>,
): Set<string> {
  const found = new Set<string>();
  const visit = (name: string) => {
    for (const other of next(name)) {
      if (!found.has(other)) {
        found.add(other);
        visit(other);
      }
    }
  };
  visit(start);
  return found;
}

function usedBy(definitions: Definitions, name: string): Set<string> {
  return reachable(name, (current) =>
    [...definitions]
      .filter(([, other]) =>
        directDependencies(definitions, other).includes(current),
      )
      .map(([otherName]) => otherName),
  );
}

function uses(definitions: Definitions, name: string): Set<string> {
  return reachable(name, (current) =>
    directDependencies(definitions, definitions.get(current)!),
  );
}

function inOrder(definitions: Definitions, names: ReadonlySet<string>) {
  return dependencyOrder(definitions).filter((name) => names.has(name));
}

/**
 * A named set of definitions, variables and functions, whose variables always hold a value.
 * A change is accepted whole or not at all: a refused change leaves the notebook as it was.
 */
export class Notebook {
  private definitionsByName = new Map<string, Definition>();
  private valuesByName = new Map<string, number>();

  constructor(readonly name: string) {}

  /**
   * Rebuilds a notebook from stored definition sources.
   * @param name the notebook's name.
   * @param sources one definition per entry; they may refer to each other in any order. The
   * entry order is kept for `definitions()` and `sources()`.
   * @throws {StorageError} when a source is not a valid definition, or the set has an unknown
   * name or a cycle.
   */
  static restore(name: string, sources: readonly string[]): Notebook {
    const notebook = new Notebook(name);
    try {
      const parsed = new Map<string, Definition>();
      for (const source of sources) {
        const line = parse(source);
        if (line.kind !== "definition") {
          throw new SemanticError("Not a definition", line.body.span);
        }
        if (parsed.has(line.name)) {
          throw new SemanticError(
            `'${line.name}' is defined twice`,
            line.nameSpan,
          );
        }
        parsed.set(line.name, line);
      }
      for (const definitionName of dependencyOrder(parsed)) {
        notebook.define(parsed.get(definitionName)!);
      }
      notebook.definitionsByName = new Map(
        [...parsed.keys()].map((key) => [
          key,
          notebook.definitionsByName.get(key)!,
        ]),
      );
    } catch (error) {
      if (error instanceof MathError || error instanceof DependencyError) {
        throw new StorageError(`notebook '${name}'`, error.message);
      }
      throw error;
    }
    return notebook;
  }

  /** The definitions in the order they were first defined. */
  definitions(): readonly DefinitionView[] {
    return [...this.definitionsByName.keys()].map((key) => this.view(key));
  }

  /** The definition sources in the order of `definitions()`. */
  sources(): readonly string[] {
    return [...this.definitionsByName.values()].map((d) => d.source);
  }

  /**
   * Runs one input line: a definition is stored, an expression is evaluated.
   * @throws {MathError} when the line fails any interpreter stage, or a cycle would form.
   * @throws {DependencyError} when a definition would break a definition that uses it.
   */
  run(line: string): RunResult {
    const parsed: Line = parse(line);
    if (parsed.kind === "definition") {
      return this.define(parsed);
    }
    const scope = this.scope();
    analyze(parsed, scope);
    return {
      kind: "expression",
      source: parsed.source,
      value: parsed.body.evaluate(scope),
    };
  }

  /**
   * Removes a definition.
   * @throws {NotFoundError} when the name is not defined.
   * @throws {DependencyError} when another definition uses it.
   */
  remove(name: string): void {
    this.require(name);
    const dependents = this.dependents(name);
    if (dependents.length > 0) {
      throw new DependencyError(
        `Cannot remove '${name}': used by ${dependents.join(", ")}`,
      );
    }
    this.definitionsByName.delete(name);
    this.valuesByName.delete(name);
  }

  /**
   * @returns the definitions `name` uses, directly or not, each after what it uses itself.
   * @throws {NotFoundError} when the name is not defined.
   */
  dependencies(name: string): string[] {
    this.require(name);
    return inOrder(this.definitionsByName, uses(this.definitionsByName, name));
  }

  /**
   * @returns the definitions that use `name`, directly or not, each after what it uses itself.
   * @throws {NotFoundError} when the name is not defined.
   */
  dependents(name: string): string[] {
    this.require(name);
    return inOrder(
      this.definitionsByName,
      usedBy(this.definitionsByName, name),
    );
  }

  private require(name: string): void {
    if (!this.definitionsByName.has(name)) {
      throw new NotFoundError(`'${name}' is not defined`);
    }
  }

  private scope(): Scope {
    return scopeOver(this.definitionsByName, this.valuesByName);
  }

  private view(name: string): DefinitionView {
    const definition = this.definitionsByName.get(name)!;
    const view: DefinitionView = {
      name,
      params: definition.params,
      source: definition.source,
      dependsOn: directDependencies(this.definitionsByName, definition),
    };
    const value = this.valuesByName.get(name);
    return value === undefined ? view : { ...view, value };
  }

  private define(definition: Definition): RunResult {
    const { name } = definition;
    const next = new Map(this.definitionsByName).set(name, definition);
    const values = new Map(this.valuesByName);
    values.delete(name);
    const scope = () => scopeOver(next, values);

    analyze(definition, scope());
    this.refuseCycle(next, definition);

    const dependents = inOrder(next, usedBy(next, name));
    for (const dependent of dependents) {
      this.guardDependent(name, dependent, () =>
        analyze(next.get(dependent)!, scope()),
      );
    }
    if (definition.params.length === 0) {
      values.set(name, definition.body.evaluate(scope()));
    }
    const recomputed: { name: string; value: number }[] = [];
    for (const dependent of dependents) {
      const other = next.get(dependent)!;
      if (other.params.length > 0) continue;
      this.guardDependent(name, dependent, () => {
        values.set(dependent, other.body.evaluate(scope()));
      });
      recomputed.push({ name: dependent, value: values.get(dependent)! });
    }

    this.definitionsByName = next;
    this.valuesByName = values;
    return {
      kind: "definition",
      source: definition.source,
      definition: this.view(name),
      recomputed,
    };
  }

  private refuseCycle(next: Definitions, definition: Definition): void {
    if (!uses(next, definition.name).has(definition.name)) return;
    const path = [definition.name];
    let current = definition.name;
    do {
      current = directDependencies(next, next.get(current)!).find(
        (used) =>
          used === definition.name || uses(next, used).has(definition.name),
      )!;
      path.push(current);
    } while (current !== definition.name);
    throw new SemanticError(`Cycle: ${path.join(" -> ")}`, definition.nameSpan);
  }

  private guardDependent(
    name: string,
    dependent: string,
    action: () => void,
  ): void {
    try {
      action();
    } catch (error) {
      if (error instanceof MathError) {
        throw new DependencyError(
          `Cannot define '${name}': '${dependent}' would fail with ${error.stage} error: ${error.message}`,
        );
      }
      throw error;
    }
  }
}
