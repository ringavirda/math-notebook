import {
  BinaryNode,
  CallNode,
  type ExprNode,
  NameNode,
  NumberNode,
  UnaryNode,
} from "./ast.js";
import { LexError, ParseError, type Span } from "./errors.js";
import { tokenize, type Token } from "./lexer.js";

/** `name = expr` or `name(params) = expr`. */
export interface Definition {
  kind: "definition";
  name: string;
  params: readonly string[];
  body: ExprNode;
  source: string;
  nameSpan: Span;
}

/** A bare expression to evaluate. */
export interface Expression {
  kind: "expression";
  body: ExprNode;
  source: string;
}

/** One parsed input line. */
export type Line = Definition | Expression;

class Parser {
  private at = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  line(source: string): Line {
    const equals = this.tokens.findIndex((token) => token.kind === "equals");
    if (equals < 0) {
      return { kind: "expression", body: this.finished(), source };
    }
    const head = this.head(equals);
    this.at = equals + 1;
    return { kind: "definition", ...head, body: this.finished(), source };
  }

  private head(equals: number): {
    name: string;
    params: string[];
    nameSpan: Span;
  } {
    const left = this.tokens.slice(0, equals);
    const bad = () => {
      const span = {
        start: this.tokens[0].span.start,
        end:
          left.length === 0
            ? this.tokens[equals].span.end
            : this.tokens[equals].span.start,
      };
      return new ParseError(
        "The left side of '=' must be a name or name(params)",
        span,
      );
    };
    if (left.length === 0 || left[0].kind !== "name") throw bad();
    const nameSpan = left[0].span;
    const name = left[0].text;
    if (left.length === 1) return { name, params: [], nameSpan };
    if (left[1].kind !== "lparen" || left[left.length - 1].kind !== "rparen")
      throw bad();
    const params: string[] = [];
    const inner = left.slice(2, -1);
    if (inner.length === 0)
      throw new ParseError(
        "A function needs at least one parameter",
        left[1].span,
      );
    for (let i = 0; i < inner.length; i += 1) {
      const token = inner[i];
      if (i % 2 === 0) {
        if (token.kind !== "name") throw bad();
        if (params.includes(token.text)) {
          throw new ParseError(
            `Repeated parameter '${token.text}'`,
            token.span,
          );
        }
        params.push(token.text);
      } else if (token.kind !== "comma") {
        throw bad();
      }
    }
    if (inner.length % 2 === 0) throw bad();
    return { name, params, nameSpan };
  }

  private finished(): ExprNode {
    const body = this.expr();
    const token = this.peek();
    if (token.kind !== "end") {
      throw new ParseError(this.unexpected(token), token.span);
    }
    return body;
  }

  private peek(): Token {
    return this.tokens[this.at];
  }

  private next(): Token {
    const token = this.tokens[this.at];
    if (token.kind !== "end") this.at += 1;
    return token;
  }

  private isOperator(...texts: string[]): boolean {
    const token = this.peek();
    return token.kind === "operator" && texts.includes(token.text);
  }

  private unexpected(token: Token): string {
    return token.kind === "end"
      ? "Unexpected end of line"
      : `Unexpected '${token.text}'`;
  }

  private spanFrom(start: number): Span {
    return { start, end: this.tokens[this.at - 1].span.end };
  }

  private expr(): ExprNode {
    const start = this.peek().span.start;
    let left = this.term();
    while (this.isOperator("+", "-")) {
      const operator = this.next().text;
      const right = this.term();
      left = new BinaryNode(operator, left, right, this.spanFrom(start));
    }
    return left;
  }

  private term(): ExprNode {
    const start = this.peek().span.start;
    let left = this.unary();
    while (this.isOperator("*", "/", "%")) {
      const operator = this.next().text;
      const right = this.unary();
      left = new BinaryNode(operator, left, right, this.spanFrom(start));
    }
    return left;
  }

  private unary(): ExprNode {
    const start = this.peek().span.start;
    if (this.isOperator("-")) {
      this.next();
      const operand = this.unary();
      return new UnaryNode(operand, this.spanFrom(start));
    }
    return this.power();
  }

  private power(): ExprNode {
    const start = this.peek().span.start;
    const base = this.primary();
    if (this.isOperator("^")) {
      this.next();
      const exponent = this.unary();
      return new BinaryNode("^", base, exponent, this.spanFrom(start));
    }
    return base;
  }

  private primary(): ExprNode {
    const token = this.next();
    switch (token.kind) {
      case "number": {
        const value = Number(token.text);
        if (!Number.isFinite(value)) {
          throw new LexError(`Number out of range '${token.text}'`, token.span);
        }
        return new NumberNode(value, token.span);
      }
      case "name":
        return this.peek().kind === "lparen"
          ? this.call(token)
          : new NameNode(token.text, token.span);
      case "lparen": {
        const inner = this.expr();
        const close = this.peek();
        if (close.kind !== "rparen") {
          throw new ParseError("Missing ')'", close.span);
        }
        this.next();
        return inner;
      }
      default:
        throw new ParseError(this.unexpected(token), token.span);
    }
  }

  private call(name: Token): ExprNode {
    this.next();
    const args = [this.expr()];
    while (this.peek().kind === "comma") {
      this.next();
      args.push(this.expr());
    }
    const close = this.peek();
    if (close.kind !== "rparen") {
      throw new ParseError("Missing ')'", close.span);
    }
    this.next();
    return new CallNode(name.text, args, this.spanFrom(name.span.start));
  }
}

/**
 * Parses one input line into a definition or an expression.
 * @param line the text; leading and trailing blanks are ignored in `source`.
 * @throws {LexError} from the lexer, or on a number literal too large to be finite.
 * @throws {ParseError} on a token that does not fit the grammar, a missing `)`, a left side of `=`
 * that is not a name or name(params), or a repeated parameter.
 */
export function parse(line: string): Line {
  return new Parser(tokenize(line)).line(line.trim());
}
