import { EventBus } from "@mathbook/events";
import { StderrLogger } from "@mathbook/logging";
import { describe, expect, it, vi } from "vitest";
import {
  DependencyError,
  describeEvent,
  Notebook,
  NotebookService,
  type NotebookEvent,
  type NotebookRepository,
} from "../src/index.js";
import { MemoryNotebookRepository } from "../src/testing.js";

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

describe("NotebookService with the memory repository", () => {
  it("publishes defined then recomputed, in order", async () => {
    const { service, published } = setup();
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
    const { service, published } = setup();
    await service.run("main", "2 * 3");
    expect(published).toEqual([
      { type: "evaluated", notebook: "main", source: "2 * 3", value: 6 },
    ]);
  });

  it("keeps notebooks apart and saves definitions", async () => {
    const { service } = setup();
    await service.run("main", "a = 1");
    await service.run("other", "b = 2");
    expect(await service.list()).toEqual(["main", "other"]);
    expect((await service.show("main")).map((d) => d.name)).toEqual(["a"]);
    expect(await service.show("none")).toEqual([]);
  });

  it("records successes and failures with the stage, newest first", async () => {
    const { service } = setup();
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
    const { service, published } = setup();
    await expect(service.run("main", "  1 / 0  ")).rejects.toThrow();
    const [record] = await service.history("main", {
      limit: 1,
      failedOnly: true,
    });
    expect(record.source).toBe("1 / 0");
    expect(published[0]).toMatchObject({ type: "failed", source: "1 / 0" });
  });

  it("records a refused define as a domain failure and publishes failed", async () => {
    const { service, published } = setup();
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
    const { service, published } = setup();
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
    const { service } = setup();
    await service.run("main", "a = 1");
    await service.run("main", "b = a");
    await service.run("main", "c = b");
    expect(await service.dependencies("main", "b")).toEqual({
      uses: ["a"],
      usedBy: ["c"],
    });
  });

  it("rethrows an unexpected error without recording it", async () => {
    const { service, published } = setup();
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
    const { service, lines } = setup();
    await service.run("main", "1 + 1");
    expect(lines[0]).toMatch(/^\[debug\] run\(main, 1 \+ 1\) took \d+ ms$/);
  });
});

describe("NotebookService with a mock repository", () => {
  function mock() {
    return {
      open: vi.fn(),
      close: vi.fn(),
      names: vi.fn(async () => []),
      load: vi.fn(async (name: string) => new Notebook(name)),
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
  });
});
