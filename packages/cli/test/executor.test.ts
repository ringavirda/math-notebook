import { describe, expect, it, vi } from "vitest";

import {
  Executor,
  UsageError,
  checkArguments,
  type Command,
  type Middleware,
} from "../src/index.js";

function createExecutor() {
  const printed: [string, string][] = [];
  const executor = new Executor({
    echo: (message = "") => printed.push(["echo", message]),
    echoError: (message) => printed.push(["error", message]),
  });
  return { printed, executor };
}

const command = (
  selectors: string[],
  action: Command["action"] = () => {},
  params: string[] = [],
): Command => ({ selectors, params, description: "d", action });

describe("Executor", () => {
  it("throws on a held selector", () => {
    const { executor } = createExecutor();
    expect(() => executor.registerCommand(command(["h", "x"]))).toThrow(
      "Command with selectors (help, h) already exists! Use override flag to replace it.",
    );
  });

  it("override replaces in place", async () => {
    const { executor, printed } = createExecutor();
    executor.registerCommand(command(["a"]));
    executor.registerCommand(command(["b"]));
    executor.registerCommand(command(["a'", "a"]), true);
    await executor.execute("help");
    expect(printed.map(([, m]) => m.split(" ")[2])).toEqual([
      "help,",
      "a',",
      "b",
    ]);
  });

  it("runs middleware in use order around the action", async () => {
    const { executor } = createExecutor();
    const trace: string[] = [];
    const step =
      (name: string): Middleware =>
      async (_context, next) => {
        trace.push(`${name} before`);
        await next();
        trace.push(`${name} after`);
      };
    executor.use(step("1"));
    executor.use(step("2"));
    executor.registerCommand(command(["go"], () => void trace.push("action")));
    await executor.execute("go");
    expect(trace).toEqual([
      "1 before",
      "2 before",
      "action",
      "2 after",
      "1 after",
    ]);
  });

  it("a middleware that skips next skips the action", async () => {
    const { executor } = createExecutor();
    const action = vi.fn();
    executor.use(async () => {});
    executor.registerCommand(command(["go"], action));
    expect(await executor.execute("go")).toBe("ok");
    expect(action).not.toHaveBeenCalled();
  });

  it("an unknown selector prints and returns unknown without middleware", async () => {
    const { executor, printed } = createExecutor();
    const middleware = vi.fn<Middleware>(async (_context, next) => next());
    executor.use(middleware);
    expect(await executor.execute("nope")).toBe("unknown");
    expect(printed).toEqual([["error", "Unknown command: nope"]]);
    expect(middleware).not.toHaveBeenCalled();
  });

  it("a blank line returns empty and prints nothing", async () => {
    const { executor, printed } = createExecutor();
    expect(await executor.execute("   ")).toBe("empty");
    expect(printed).toEqual([]);
  });

  it("checkArguments gives usage for too few or too many words", async () => {
    const { executor, printed } = createExecutor();
    executor.use(checkArguments);
    executor.registerCommand(command(["x"], () => {}, ["a", "b?"]));
    expect(await executor.execute("x")).toBe("usage");
    expect(await executor.execute("x 1 2 3")).toBe("usage");
    expect(printed).toEqual([
      ["error", "Usage: x <a> [b]"],
      ["error", "Usage: x <a> [b]"],
    ]);
    expect(await executor.execute("x 1")).toBe("ok");
  });

  it("an escaping error prints its message and returns failed", async () => {
    const { executor, printed } = createExecutor();
    executor.registerCommand(
      command(["boom"], () => {
        throw new Error("broken");
      }),
    );
    expect(await executor.execute("boom")).toBe("failed");
    expect(printed).toEqual([["error", "broken"]]);
  });

  it("a middleware that handles an error sets the status", async () => {
    const { executor, printed } = createExecutor();
    executor.use(async (context, next) => {
      try {
        await next();
      } catch {
        context.status = "usage";
      }
    });
    executor.registerCommand(
      command(["boom"], () => {
        throw new UsageError("bad");
      }),
    );
    expect(await executor.execute("boom")).toBe("usage");
    expect(printed).toEqual([]);
  });

  it("help lists every command with its params", async () => {
    const { executor, printed } = createExecutor();
    executor.registerCommand(command(["add", "a"], () => {}, ["x", "y?"]));
    await executor.execute("help");
    expect(printed).toEqual([
      ["echo", "  help, h [command] - Show the command list or one command."],
      ["echo", "  add, a <x> [y] - d"],
    ]);
  });

  it("help for an unknown command is a usage error", async () => {
    const { executor, printed } = createExecutor();
    expect(await executor.execute("help nope")).toBe("usage");
    expect(printed).toEqual([["error", "Unknown command: nope"]]);
  });

  it("a fallback runs for an unknown selector inside the middleware", async () => {
    const { executor, printed } = createExecutor();
    const trace: string[] = [];
    executor.use(async (context, next) => {
      trace.push(`before ${context.selector}`);
      await next();
      trace.push("after");
    });
    executor.use(checkArguments);
    executor.fallback(async (line, context) => {
      trace.push(`${line}|${context.words.length}`);
    });
    expect(await executor.execute("  a = b + 1 ")).toBe("ok");
    expect(trace).toEqual(["before a", "a = b + 1|4", "after"]);
    expect(printed).toEqual([]);
  });

  it("a registered command wins over the fallback", async () => {
    const { executor } = createExecutor();
    const fallback = vi.fn(async () => {});
    const action = vi.fn();
    executor.fallback(fallback);
    executor.registerCommand(command(["go"], action));
    await executor.execute("go");
    expect(action).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("an error from the fallback prints and returns failed", async () => {
    const { executor, printed } = createExecutor();
    executor.fallback(async () => {
      throw new Error("bad line");
    });
    expect(await executor.execute("1 +")).toBe("failed");
    expect(printed).toEqual([["error", "bad line"]]);
  });
});
