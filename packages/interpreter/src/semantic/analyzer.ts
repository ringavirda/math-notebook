import {
  BinaryNode,
  CallNode,
  type ExprNode,
  NameNode,
  UnaryNode,
} from "../syntax/ast.js";
import { SemanticError } from "../errors.js";
import type { Line } from "../syntax/parser.js";
import { type Binding, isBuiltin, type Scope, scopeOf } from "./scope.js";

function check(node: ExprNode, scope: Scope): void {
  if (node instanceof NameNode) {
    const binding = scope.lookup(node.name);
    if (binding === undefined) {
      throw new SemanticError(`Unknown name '${node.name}'`, node.span);
    }
    if (binding.kind === "function") {
      throw new SemanticError(
        `'${node.name}' is a function; call it as ${node.name}(...)`,
        node.span,
      );
    }
  } else if (node instanceof CallNode) {
    const binding = scope.lookup(node.callee);
    if (binding === undefined) {
      throw new SemanticError(`Unknown function '${node.callee}'`, node.span);
    }
    if (binding.kind === "value") {
      throw new SemanticError(
        `'${node.callee}' is a variable, not a function`,
        node.span,
      );
    }
    if (binding.arity !== "variadic" && binding.arity !== node.args.length) {
      const plural = binding.arity === 1 ? "argument" : "arguments";
      throw new SemanticError(
        `'${node.callee}' takes ${binding.arity} ${plural}, got ${node.args.length}`,
        node.span,
      );
    }
    node.args.forEach((arg) => check(arg, scope));
  } else if (node instanceof UnaryNode) {
    check(node.operand, scope);
  } else if (node instanceof BinaryNode) {
    check(node.left, scope);
    check(node.right, scope);
  }
}

/**
 * Checks a parsed line against a scope without evaluating it. Inside a definition body its
 * parameters shadow the scope.
 * @param line the parsed line.
 * @param scope the names visible to the line.
 * @throws {SemanticError} on an unknown name, a function used as a value, a variable called as a
 * function, a wrong argument count, or a definition that redefines a built-in.
 */
export function analyze(line: Line, scope: Scope): void {
  if (line.kind === "expression") {
    check(line.body, scope);
    return;
  }
  if (isBuiltin(line.name)) {
    throw new SemanticError(
      `Cannot redefine the built-in '${line.name}'`,
      line.nameSpan,
    );
  }
  const params = new Map<string, Binding>(
    line.params.map((param) => [param, { kind: "value", value: 0 }]),
  );
  check(line.body, scopeOf(params, scope));
}
