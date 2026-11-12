import { EventBus } from "@mathbook/common";
import { StderrLogger } from "@mathbook/hosting";
import { describe, expect, it, vi } from "vitest";
import {
  DependencyError,
  describeEvent,
  DuplicateError,
  InvalidNameError,
  NotFoundError,
  Notebook,
  notebookNamePattern,
  NotebookService,
  StorageError,
  type NotebookEvent,
  type NotebookRepository,
} from "../../src/index.js";
import { MemoryNotebookRepository } from "../../src/testing.js";

const now = new Date("2026-11-12T10:00:00Z");

function setup(
  repository: NotebookRepository = new MemoryNotebookRepository(),
) {
  const events = new EventBus<NotebookEvent>();
  const published: NotebookEvent[] = [];
  events.subscribe((event) => published.push(event));
  const lines: string[] = [];
  const logger = new StderrLogger("debug", (line) => lines.push(line));
  const service = new NotebookService(repository, events, logger, () => now);
  return { service, published, lines, repository };
}

async function ready() {
  const made = setup();
  await made.repository.create("main");
  return made;
}

describe("NotebookService with the memory repository", () => {
  it("publishes defined then recomputed, in order", async () => {
    const { service, published } = await ready();
    await service.run("main", "price = 40");
    await service.run("main", "subtotal = price * 2");
    published.length = 0;
    await service.run("main", "price = 50");
    expect(published).toEqual([
      {
        type: "defined",
        notebook: "main",
        name: "price",
        source: "price = 50",
      },
      { type: "recomputed", notebook: "main", name: "subtotal", value: 100 },
    ]);
  });

  it("publishes evaluated for an expression", async () => {
    const { service, published } = await ready();
    await service.run("main", "2 * 3");
    expect(published).toEqual([
      { type: "evaluated", notebook: "main", source: "2 * 3", value: 6 },
    ]);
  });

  it("keeps notebooks apart and saves definitions", async () => {
    const { service } = await ready();
    await service.run("main", "a = 1");
    await service.create("other");
    await service.run("other", "b = 2");
    expect(await service.list()).toEqual(["main", "other"]);
    expect((await service.show("main")).map((d) => d.name)).toEqual(["a"]);
    expect((await service.show("other")).map((d) => d.name)).toEqual(["b"]);
  });

  it("records successes and failures with the stage, newest first", async () => {
    const { service } = await ready();
    await service.run("main", "x = 1");
    await service.run("main", "x + 1");
    await expect(service.run("main", "1 / 0")).rejects.toThrow();
    await expect(service.run("main", "1 +")).rejects.toThrow();
    await expect(service.run("main", "x = y")).rejects.toThrow();
    await expect(service.run("main", "1 $ 2")).rejects.toThrow();

    const all = await service.history("main", { limit: 10, failedOnly: false });
    expect(
      all.map((r) => [r.source, r.kind, r.result, r.error?.stage]),
    ).toEqual([
      ["1 $ 2", "expression", null, "lexical"],
      ["x = y", "definition", null, "semantic"],
      ["1 +", "expression", null, "syntax"],
      ["1 / 0", "expression", null, "evaluation"],
      ["x + 1", "expression", 2, undefined],
      ["x = 1", "definition", 1, undefined],
    ]);
    expect(all[0].at).toEqual(now);

    const failed = await service.history("main", {
      limit: 2,
      failedOnly: true,
    });
    expect(failed.map((r) => r.source)).toEqual(["1 $ 2", "x = y"]);
  });

  it("stores and publishes a failed line trimmed", async () => {
    const { service, published } = await ready();
    await expect(service.run("main", "  1 / 0  ")).rejects.toThrow();
    const [record] = await service.history("main", {
      limit: 1,
      failedOnly: true,
    });
    expect(record.source).toBe("1 / 0");
    expect(published[0]).toMatchObject({ type: "failed", source: "1 / 0" });
  });

  it("records a refused define as a domain failure and publishes failed", async () => {
    const { service, published } = await ready();
    await service.run("main", "x = 1");
    await service.run("main", "y = 1 / x");
    published.length = 0;
    await expect(service.run("main", "x = 0")).rejects.toThrow(DependencyError);
    const [record] = await service.history("main", {
      limit: 1,
      failedOnly: true,
    });
    expect(record.error?.stage).toBe("domain");
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ type: "failed", stage: "domain" });
    expect((await service.show("main"))[0].value).toBe(1);
  });

  it("records a refused remove nowhere and keeps the definition", async () => {
    const { service, published } = await ready();
    await service.run("main", "x = 1");
    await service.run("main", "y = x");
    published.length = 0;
    await expect(service.remove("main", "x")).rejects.toThrow(DependencyError);
    expect(published).toEqual([]);
    await service.remove("main", "y");
    expect(published).toEqual([
      { type: "removed", notebook: "main", name: "y" },
    ]);
    expect((await service.show("main")).map((d) => d.name)).toEqual(["x"]);
  });

  it("reports what a name uses and what uses it", async () => {
    const { service } = await ready();
    await service.run("main", "a = 1");
    await service.run("main", "b = a");
    await service.run("main", "c = b");
    expect(await service.dependencies("main", "b")).toEqual({
      uses: ["a"],
      usedBy: ["c"],
    });
  });

  it("rethrows an unexpected error without recording it", async () => {
    const { service, published } = await ready();
    const boom = new Error("disk");
    vi.spyOn(Notebook.prototype, "run").mockImplementationOnce(() => {
      throw boom;
    });
    await expect(service.run("main", "1")).rejects.toBe(boom);
    expect(published).toEqual([]);
    expect(
      await service.history("main", { limit: 5, failedOnly: false }),
    ).toEqual([]);
  });

  it("logs each call at debug", async () => {
    const { service, lines } = await ready();
    await service.run("main", "1 + 1");
    expect(lines[0]).toMatch(/^\[debug\] run\(main, 1 \+ 1\) took \d+ ms$/);
  });

  it("refuses every method for a missing notebook and records nothing", async () => {
    const { service, published, repository } = await ready();
    const missing = "No notebook 'ghost'";
    const query = { limit: 5, failedOnly: false };
    for (const call of [
      () => service.run("ghost", "1 + 1"),
      () => service.remove("ghost", "x"),
      () => service.show("ghost"),
      () => service.dependencies("ghost", "x"),
      () => service.history("ghost", query),
      () => service.drop("ghost"),
      () => service.rename("ghost", "fresh"),
      () => service.clearHistory("ghost"),
    ]) {
      const failure = await call().catch((error) => error);
      expect(failure).toBeInstanceOf(NotFoundError);
      expect(failure.message).toBe(missing);
    }
    expect(published).toEqual([]);
    expect(await repository.names()).toEqual(["main"]);
    expect(await repository.history("ghost", query)).toEqual([]);
  });

  it("creates a notebook and publishes created", async () => {
    const { service, published } = await ready();
    await service.create("work_2-b");
    expect(await service.list()).toEqual(["main", "work_2-b"]);
    expect(await service.show("work_2-b")).toEqual([]);
    expect(published).toEqual([{ type: "created", notebook: "work_2-b" }]);
  });

  it.each(["1x", "a b", "", "-a", "a.b"])(
    "refuses the name '%s'",
    async (name) => {
      const { service, published } = await ready();
      await expect(service.create(name)).rejects.toThrow(InvalidNameError);
      await expect(service.ensure(name)).rejects.toThrow(InvalidNameError);
      await service.run("main", "x = 1");
      await expect(service.rename("main", name)).rejects.toThrow(
        InvalidNameError,
      );
      expect(await service.list()).toEqual(["main"]);
      expect(published).toHaveLength(1);
    },
  );

  it("refuses to create a taken name", async () => {
    const { service, published } = await ready();
    await expect(service.create("main")).rejects.toThrow(DuplicateError);
    expect(published).toEqual([]);
  });

  it("ensures a notebook without an event when it exists", async () => {
    const { service, published } = await ready();
    await service.ensure("main");
    expect(published).toEqual([]);
    await service.ensure("fresh");
    expect(await service.list()).toEqual(["fresh", "main"]);
    expect(published).toEqual([{ type: "created", notebook: "fresh" }]);
  });

  it("drops a notebook and leaves the others", async () => {
    const { service, published } = await ready();
    await service.create("other");
    await service.run("main", "x = 1");
    await service.run("other", "y = 2");
    published.length = 0;
    await service.drop("main");
    expect(published).toEqual([{ type: "dropped", notebook: "main" }]);
    expect(await service.list()).toEqual(["other"]);
    expect((await service.show("other")).map((d) => d.name)).toEqual(["y"]);
    await expect(service.show("main")).rejects.toThrow(NotFoundError);
  });

  it("renames a notebook and keeps its history", async () => {
    const { service, published } = await ready();
    await service.run("main", "x = 1");
    published.length = 0;
    await service.rename("main", "work");
    expect(published).toEqual([
      { type: "renamed", notebook: "main", to: "work" },
    ]);
    expect(await service.list()).toEqual(["work"]);
    expect((await service.show("work")).map((d) => d.name)).toEqual(["x"]);
    const history = await service.history("work", {
      limit: 5,
      failedOnly: false,
    });
    expect(history.map((r) => r.source)).toEqual(["x = 1"]);
  });

  it("refuses to rename onto a taken name", async () => {
    const { service, published } = await ready();
    await service.create("other");
    published.length = 0;
    await expect(service.rename("main", "other")).rejects.toThrow(
      DuplicateError,
    );
    await expect(service.rename("main", "main")).rejects.toThrow(
      DuplicateError,
    );
    expect(published).toEqual([]);
  });

  it("clears the history and keeps the definitions", async () => {
    const { service, published } = await ready();
    await service.run("main", "x = 1");
    await service.run("main", "x + 1");
    published.length = 0;
    expect(await service.clearHistory("main")).toBe(2);
    expect(published).toEqual([
      { type: "historyCleared", notebook: "main", count: 2 },
    ]);
    expect(
      await service.history("main", { limit: 5, failedOnly: false }),
    ).toEqual([]);
    expect((await service.show("main")).map((d) => d.name)).toEqual(["x"]);
  });
});

describe("NotebookService with a mock repository", () => {
  function mock() {
    return {
      open: vi.fn(),
      close: vi.fn(),
      names: vi.fn(async () => []),
      exists: vi.fn(async () => true),
      load: vi.fn(async (name: string) => new Notebook(name)),
      create: vi.fn(async () => {}),
      drop: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
      clearHistory: vi.fn(async () => 0),
      save: vi.fn(async () => {}),
      appendEvaluation: vi.fn(async () => {}),
      history: vi.fn(async () => []),
    } satisfies NotebookRepository;
  }

  it("never saves after an expression or a failure", async () => {
    const repository = mock();
    const { service } = setup(repository);
    await service.run("main", "1 + 1");
    await expect(service.run("main", "1 / 0")).rejects.toThrow();
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.appendEvaluation).toHaveBeenCalledTimes(2);
  });

  it("saves the notebook once after a definition", async () => {
    const repository = mock();
    const { service } = setup(repository);
    await service.run("main", "x = 1");
    expect(repository.save).toHaveBeenCalledTimes(1);
    const saved = (repository.save.mock.calls[0] as unknown as [Notebook])[0];
    expect(saved.sources()).toEqual(["x = 1"]);
    expect(repository.appendEvaluation).toHaveBeenCalledWith({
      notebook: "main",
      source: "x = 1",
      kind: "definition",
      result: 1,
      error: null,
      at: now,
    });
  });

  it("passes the query to the repository", async () => {
    const repository = mock();
    const { service } = setup(repository);
    await service.history("main", { limit: 3, failedOnly: true });
    expect(repository.history).toHaveBeenCalledWith("main", {
      limit: 3,
      failedOnly: true,
    });
  });
});

describe("describeEvent", () => {
  it("writes one line per event", () => {
    expect(
      describeEvent({
        type: "recomputed",
        notebook: "main",
        name: "a",
        value: 2,
      }),
    ).toBe("[main] recomputed a = 2");
    expect(
      describeEvent({
        type: "failed",
        notebook: "main",
        source: "1 / 0",
        stage: "evaluation",
        message: "Division by zero",
      }),
    ).toBe("[main] failed 1 / 0: evaluation error: Division by zero");
    expect(describeEvent({ type: "removed", notebook: "m", name: "x" })).toBe(
      "[m] removed x",
    );
    expect(
      describeEvent({
        type: "defined",
        notebook: "m",
        name: "x",
        source: "x = 1",
      }),
    ).toBe("[m] defined x: x = 1");
    expect(
      describeEvent({
        type: "evaluated",
        notebook: "m",
        source: "1 + 1",
        value: 2,
      }),
    ).toBe("[m] evaluated 1 + 1 = 2");
    expect(describeEvent({ type: "created", notebook: "m" })).toBe(
      "[m] created",
    );
    expect(describeEvent({ type: "dropped", notebook: "m" })).toBe(
      "[m] dropped",
    );
    expect(describeEvent({ type: "renamed", notebook: "m", to: "n" })).toBe(
      "[m] renamed to n",
    );
    expect(
      describeEvent({ type: "historyCleared", notebook: "m", count: 3 }),
    ).toBe("[m] cleared 3 history records");
  });
});

describe("NotebookService queueing and storage failures", () => {
  it("keeps both definitions of two runs started together", async () => {
    const { service } = await ready();
    await Promise.all([
      service.run("main", "a = 1"),
      service.run("main", "b = 2"),
    ]);
    expect((await service.show("main")).map((d) => d.name)).toEqual(["a", "b"]);
  });

  it("goes on with the queue after a call fails", async () => {
    const { service } = await ready();
    const results = await Promise.allSettled([
      service.run("main", "1 +"),
      service.run("main", "c = 3"),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
    expect((await service.show("main")).map((d) => d.name)).toEqual(["c"]);
  });

  it("holds both names while renaming", async () => {
    const { service, published } = await ready();
    await service.run("main", "a = 1");
    const results = await Promise.allSettled([
      service.rename("main", "other"),
      service.run("other", "b = 2"),
      service.run("main", "c = 3"),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    expect(
      (await service.show("other")).map((definition) => definition.name),
    ).toEqual(["a", "b"]);
    expect(published.map((event) => event.type)).toEqual([
      "defined",
      "renamed",
      "defined",
    ]);
  });

  it("drops, renames, clears and reads history of a notebook whose source does not parse", async () => {
    class Broken extends MemoryNotebookRepository {
      override async load(): Promise<Notebook | undefined> {
        throw new StorageError("notebook 'main'", "unreadable");
      }
    }
    const { service, repository } = setup(new Broken());
    await repository.create("main");
    await expect(service.show("main")).rejects.toThrow(StorageError);
    expect(
      await service.history("main", { limit: 5, failedOnly: false }),
    ).toEqual([]);
    expect(await service.clearHistory("main")).toBe(0);
    await service.rename("main", "fixed");
    await service.drop("fixed");
    expect(await service.list()).toEqual([]);
  });

  it("exports the name pattern", () => {
    expect(notebookNamePattern.test("work_2-b")).toBe(true);
    expect(notebookNamePattern.test("2work")).toBe(false);
  });
});
