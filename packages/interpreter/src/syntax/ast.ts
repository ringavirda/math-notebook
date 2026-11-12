import { EvalError, type Span } from "../errors.js";
import { DomainFault } from "../evaluation/builtins.js";
import type { Scope } from "../semantic/scope.js";

/** Precedence used to decide where `toString` needs parentheses; higher binds tighter. */
const ADDITIVE = 1;
const MULTIPLICATIVE = 2;
const UNARY = 3;
const POWER = 4;
const ATOM = 5;

const BINARY_PRECEDENCE: Record<string, number> = {
  "+": ADDITIVE,
  "-": ADDITIVE,
  "*": MULTIPLICATIVE,
  "/": MULTIPLICATIVE,
  "%": MULTIPLICATIVE,
  "^": POWER,
};

function wrap(node: ExprNode, needsParens: boolean): string {
  return needsParens ? `(${node.toString()})` : node.toString();
}

function checked(result: number, span: Span): number {
  if (!Number.isFinite(result)) {
    throw new EvalError("Result is not a finite number", span);
  }
  return result;
}

/** A node of the expression tree (GoF Interpreter): each kind knows how to evaluate itself. */
export abstract class ExprNode {
  constructor(readonly span: Span) {}

  abstract readonly precedence: number;

  /**
   * Computes the value of this subtree.
   * @param scope where names are looked up.
   * @throws {EvalError} on division by zero, a domain error or a non-finite result.
   */
  abstract evaluate(scope: Scope): number;

  /** Every name this subtree mentions, called functions included, built-ins and parameters not excluded. */
  abstract names(): ReadonlySet<string>;

  /** Canonical source: spaces around binary operators, parentheses only where precedence needs them. */
  abstract toString(): string;
}

/** A numeric literal. */
export class NumberNode extends ExprNode {
  readonly precedence = ATOM;

  constructor(
    readonly value: number,
    span: Span,
  ) {
    super(span);
  }

  evaluate(): number {
    return this.value;
  }

  names(): ReadonlySet<string> {
    return new Set();
  }

  toString(): string {
    return String(this.value);
  }
}

/** A reference to a variable or parameter. */
export class NameNode extends ExprNode {
  readonly precedence = ATOM;

  constructor(
    readonly name: string,
    span: Span,
  ) {
    super(span);
  }

  evaluate(scope: Scope): number {
    const binding = scope.lookup(this.name);
    if (binding?.kind !== "value") {
      throw new EvalError(`'${this.name}' has no value`, this.span);
    }
    return binding.value;
  }

  names(): ReadonlySet<string> {
    return new Set([this.name]);
  }

  toString(): string {
    return this.name;
  }
}

/** Negation of `operand`. */
export class UnaryNode extends ExprNode {
  readonly precedence = UNARY;

  constructor(
    readonly operand: ExprNode,
    span: Span,
  ) {
    super(span);
  }

  evaluate(scope: Scope): number {
    return -this.operand.evaluate(scope);
  }

  names(): ReadonlySet<string> {
    return this.operand.names();
  }

  toString(): string {
    return `-${wrap(this.operand, this.operand.precedence < UNARY)}`;
  }
}

/** `left operator right` for `+ - * / % ^`. */
export class BinaryNode extends ExprNode {
  readonly precedence: number;

  constructor(
    readonly operator: string,
    readonly left: ExprNode,
    readonly right: ExprNode,
    span: Span,
  ) {
    super(span);
    this.precedence = BINARY_PRECEDENCE[operator];
  }

  evaluate(scope: Scope): number {
    const left = this.left.evaluate(scope);
    const right = this.right.evaluate(scope);
    switch (this.operator) {
      case "+":
        return checked(left + right, this.span);
      case "-":
        return checked(left - right, this.span);
      case "*":
        return checked(left * right, this.span);
      case "/":
        if (right === 0) throw new EvalError("Division by zero", this.span);
        return checked(left / right, this.span);
      case "%":
        if (right === 0) throw new EvalError("Division by zero", this.span);
        return checked(left % right, this.span);
      default:
        return checked(left ** right, this.span);
    }
  }

  names(): ReadonlySet<string> {
    return new Set([...this.left.names(), ...this.right.names()]);
  }

  toString(): string {
    const power = this.operator === "^";
    const leftParens = power
      ? this.left.precedence <= POWER
      : this.left.precedence < this.precedence;
    const rightParens = power
      ? this.right.precedence < UNARY
      : this.right.precedence <= this.precedence;
    return `${wrap(this.left, leftParens)} ${this.operator} ${wrap(this.right, rightParens)}`;
  }
}

/** A call of the function `callee` with `args`. */
export class CallNode extends ExprNode {
  readonly precedence = ATOM;

  constructor(
    readonly callee: string,
    readonly args: readonly ExprNode[],
    span: Span,
  ) {
    super(span);
  }

  evaluate(scope: Scope): number {
    const binding = scope.lookup(this.callee);
    if (binding?.kind !== "function") {
      throw new EvalError(`'${this.callee}' is not a function`, this.span);
    }
    const values = this.args.map((arg) => arg.evaluate(scope));
    try {
      return checked(binding.call(values), this.span);
    } catch (error) {
      if (error instanceof DomainFault) {
        throw new EvalError(error.message, this.span);
      }
      if (error instanceof EvalError) {
        throw new EvalError(`In ${this.callee}: ${error.message}`, this.span);
      }
      throw error;
    }
  }

  names(): ReadonlySet<string> {
    return new Set([
      this.callee,
      ...this.args.flatMap((arg) => [...arg.names()]),
    ]);
  }

  toString(): string {
    return `${this.callee}(${this.args.map((arg) => arg.toString()).join(", ")})`;
  }
}
