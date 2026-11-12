import { StorageError } from "@mathbook/notebook";
import { describe, expect, it, vi } from "vitest";
import { createHarness } from "./harness.js";

async function session(lines: string[], notebook?: string) {
  const harness = createHarness(notebook);
  const statuses: string[] = [];
  for (const line of lines) statuses.push(await harness.executor.execute(line));
  return { ...harness, statuses };
}

describe("lines", () => {
  it("evaluates an expression and a definition with its recomputed variables", async () => {
    const { stdout, statuses } = await session([
      "price = 40",
      "subtotal = price * 2",
      "price = 50",
      "subtotal + 1",
    ]);
    expect(statuses).toEqual(["ok", "ok", "ok", "ok"]);
    expect(stdout()).toEqual([
      "price = 40",
      "subtotal = 80",
      "price = 50",
      "  subtotal = 100",
      "101",
    ]);
  });

  it("lets a name start with h", async () => {
    const { stdout, statuses } = await session(["h = 3", "h"]);
    expect(statuses).toEqual(["ok", "ok"]);
    expect(stdout()).toEqual(["h = 3", "3"]);
  });

  it("prints a math error with a caret and is failed", async () => {
    const { stderr, statuses } = await session(["1 + * 2"]);
    expect(statuses).toEqual(["failed"]);
    expect(stderr()).toEqual([
      "Err: Syntax error: Unexpected '*'",
      "Err: 1 + * 2",
      "Err:     ^",
    ]);
  });

  it("prints a storage error as its message and is failed", async () => {
    const harness = createHarness();
    vi.spyOn(harness.repository, "load").mockRejectedValue(
      new StorageError("notebook main", "bad row"),
    );
    expect(await harness.executor.execute("1 + 2")).toBe("failed");
    expect(harness.stderr()).toEqual([
      "Err: Cannot read notebook main: bad row",
    ]);
  });

  it("prints a domain error as its message and is failed", async () => {
    const { stderr, statuses } = await session(["x = 1", "y = 1 / x", "x = 0"]);
    expect(statuses).toEqual(["ok", "ok", "failed"]);
    expect(stderr()).toHaveLength(1);
    expect(stderr()[0]).toContain("y");
  });

  it("calls an unknown :word a usage error", async () => {
    const { stderr, statuses } = await session([":nope now"]);
    expect(statuses).toEqual(["usage"]);
    expect(stderr()).toEqual(["Err: Unknown command: :nope"]);
  });
});

describe("commands", () => {
  it(":ls prints values and function bodies, :deps both directions", async () => {
    const { stdout } = await session([
      "rate = 0.2",
      "total(n) = n * rate",
      "bill = total(3)",
      ":ls",
      ":deps total",
    ]);
    expect(stdout().slice(3)).toEqual([
      "rate = 0.2",
      "total(n) = n * rate",
      "bill = 0.6",
      "uses: rate",
      "used by: bill",
    ]);
  });

  it(":use switches the notebook and :notebooks lists saved ones", async () => {
    const { stdout } = await session([
      "a = 1",
      ":use other",
      ":ls",
      "b = 2",
      ":notebooks",
    ]);
    expect(stdout()).toEqual([
      "a = 1",
      "Using notebook other",
      "Nothing defined yet.",
      "b = 2",
      "main",
      "other",
    ]);
  });

  it(":rm removes a definition and refuses a used one", async () => {
    const { stdout, stderr, statuses } = await session([
      "a = 1",
      "b = a",
      ":rm a",
      ":rm b",
      ":ls",
    ]);
    expect(statuses).toEqual(["ok", "ok", "failed", "ok", "ok"]);
    expect(stderr()).toHaveLength(1);
    expect(stdout().slice(2)).toEqual(["Removed b", "a = 1"]);
  });

  it(":history takes a limit and failed", async () => {
    const { stdout, statuses } = await session([
      "1 + 2",
      "1 +",
      "3 * 3",
      ":history 2 failed",
      ":history 2",
    ]);
    expect(statuses.slice(3)).toEqual(["ok", "ok"]);
    const failure =
      "2026-11-12 10:00:00 1 + => Syntax error: Unexpected end of line";
    expect(stdout().slice(2)).toEqual([
      failure,
      "2026-11-12 10:00:00 3 * 3 => 9",
      failure,
    ]);
  });

  it(":history rejects a bad word and zero", async () => {
    const { statuses } = await session([":history x", ":history 0"]);
    expect(statuses).toEqual(["usage", "usage"]);
  });

  it(":help lists the commands and :help ls describes one", async () => {
    const { stdout } = await session([":help", ":help ls"]);
    const lines = stdout();
    expect(lines[0]).toContain(":help");
    expect(lines.some((l) => l.includes(":history [n] [failed]"))).toBe(true);
    expect(lines.at(-1)).toContain(":ls");
  });

  it("starts in the notebook of the configuration", async () => {
    const { repository } = await session(["a = 1"], "work");
    expect(await repository.names()).toEqual(["work"]);
  });
});
