import { StorageError } from "@mathbook/notebook";
import { describe, expect, it, vi } from "vitest";
import { MemoryNotebookRepository } from "@mathbook/notebook/testing";
import { createHarness } from "./harness.js";

async function session(
  lines: string[],
  notebook?: string,
  input: string[] = [],
) {
  const harness = createHarness(notebook, input);
  await harness.ready;
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
    await harness.ready;
    vi.spyOn(harness.repository, "load").mockRejectedValue(
      new StorageError("notebook main", "bad row"),
    );
    expect(await harness.executor.execute("1 + 2")).toBe("failed");
    expect(harness.stderr()).toEqual([
      "Err: Cannot read notebook main: bad row",
    ]);
  });

  it("rejects start when the storage fails with something other than a storage error", async () => {
    const repository = new MemoryNotebookRepository();
    vi.spyOn(repository, "exists").mockRejectedValue(new Error("database is locked"));
    const harness = createHarness("main", [], repository);
    await expect(harness.ready).rejects.toThrow("database is locked");
  });

  it("prints a domain error as its message and is failed", async () => {
    const { stderr, statuses } = await session(["x = 1", "y = 1 / x", "x = 0"]);
    expect(statuses).toEqual(["ok", "ok", "failed"]);
    expect(stderr()).toHaveLength(1);
    expect(stderr()[0]).toMatch(/^Err: Cannot define 'x': 'y' would fail/);
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

  it(":new creates and switches, :notebooks marks the current one", async () => {
    const { stdout } = await session([
      "a = 1",
      ":new other",
      ":ls",
      "b = 2",
      ":notebooks",
    ]);
    expect(stdout()).toEqual([
      "a = 1",
      "Created other",
      "Nothing defined yet.",
      "b = 2",
      "  main",
      "* other",
    ]);
  });

  it(":new refuses a taken name and a bad name", async () => {
    const { stderr, statuses } = await session([":new main", ":new 1x"]);
    expect(statuses).toEqual(["failed", "failed"]);
    expect(stderr()).toHaveLength(2);
  });

  it(":use switches to an existing notebook and refuses a missing one", async () => {
    const { stdout, stderr, statuses } = await session([
      ":new other",
      "b = 2",
      ":use main",
      ":ls",
      ":use nope",
      ":use other",
      ":ls",
    ]);
    expect(statuses).toEqual(["ok", "ok", "ok", "ok", "usage", "ok", "ok"]);
    expect(stderr()).toEqual([
      "Err: No notebook 'nope'; create it with :new nope",
    ]);
    expect(stdout()).toEqual([
      "Created other",
      "b = 2",
      "Using notebook main",
      "Nothing defined yet.",
      "Using notebook other",
      "b = 2",
    ]);
  });

  it(":drop refuses the current notebook", async () => {
    const { stderr, statuses, repository } = await session([":drop main"]);
    expect(statuses).toEqual(["usage"]);
    expect(stderr()).toEqual([
      "Err: You are in main; :use another notebook first",
    ]);
    expect(await repository.names()).toEqual(["main"]);
  });

  it(":drop asks and drops on y or yes in any case", async () => {
    for (const answer of ["y\n", " YES \n"]) {
      const { stdout, repository } = await session(
        [":new a", "x = 1", ":use main", ":drop a"],
        "main",
        [answer],
      );
      expect(stdout().at(-1)).toBe(
        "Drop a with 1 definitions and its history? (y/N) Dropped a",
      );
      expect(await repository.names()).toEqual(["main"]);
    }
  });

  it(":drop keeps the notebook on n, on another word and at end of input", async () => {
    for (const input of [["n\n"], ["maybe\n"], []]) {
      const { stdout, repository } = await session(
        [":new a", ":use main", ":drop a"],
        "main",
        input,
      );
      expect(stdout().at(-1)).toBe(
        "Drop a with 0 definitions and its history? (y/N) Kept a",
      );
      expect(await repository.names()).toEqual(["a", "main"]);
    }
  });

  it(":drop of a missing notebook fails without asking", async () => {
    const { stderr, statuses } = await session([":drop nope"]);
    expect(statuses).toEqual(["failed"]);
    expect(stderr()).toEqual(["Err: No notebook 'nope'"]);
  });

  it(":rename renames the current notebook and stays in it", async () => {
    const { stdout, repository } = await session([
      "a = 1",
      ":rename work",
      ":ls",
      ":notebooks",
    ]);
    expect(stdout()).toEqual(["a = 1", "Renamed to work", "a = 1", "* work"]);
    expect(await repository.names()).toEqual(["work"]);
  });

  it(":rename refuses a taken name", async () => {
    const { statuses, stderr } = await session([":new b", ":rename main"]);
    expect(statuses).toEqual(["ok", "failed"]);
    expect(stderr()).toHaveLength(1);
  });

  it(":clear empties the history and keeps the definitions", async () => {
    const { stdout } = await session([
      "a = 1",
      "a + 1",
      ":clear",
      ":history",
      ":ls",
    ]);
    expect(stdout()).toEqual([
      "a = 1",
      "2",
      "Cleared 2 evaluations",
      "No evaluations.",
      "a = 1",
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

  it(":q is listed and ends a one-shot run as done", async () => {
    const { stdout, statuses } = await session([":help", ":q"]);
    expect(stdout().some((l) => l.includes(":q - "))).toBe(true);
    expect(statuses).toEqual(["ok", "ok"]);
  });

  it("logs the time of a run at debug level", async () => {
    const { logs } = await session(["x = 7"]);
    expect(logs).toContain("[debug] run(main, x = 7) took 0 ms");
  });

  it("starts in the notebook of the configuration", async () => {
    const { repository } = await session(["a = 1"], "work");
    expect(await repository.names()).toEqual(["work"]);
  });
});
