import { StderrLogger } from "@mathbook/hosting";
import {
  DuplicateError,
  Notebook,
  NotFoundError,
  StorageError,
  type EvaluationRecord,
} from "@mathbook/notebook";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteNotebookRepository } from "../src/index.js";

const lines: string[] = [];
const logger = new StderrLogger("debug", (line) => lines.push(line));
const open: SqliteNotebookRepository[] = [];
const folders: string[] = [];

async function memoryRepository(): Promise<SqliteNotebookRepository> {
  const repository = new SqliteNotebookRepository(":memory:", logger);
  await repository.open();
  open.push(repository);
  await repository.create("prices");
  return repository;
}

function priceNotebook(name: string): Notebook {
  const notebook = new Notebook(name);
  for (const line of [
    "rate = 0.2",
    "price = 40",
    "total(n) = n * price * (1 + rate)",
    "subtotal = price * 2",
  ]) {
    notebook.run(line);
  }
  return notebook;
}

function record(
  source: string,
  minute: number,
  error: EvaluationRecord["error"] = null,
  notebook = "prices",
): EvaluationRecord {
  return {
    notebook,
    source,
    kind: "expression",
    result: error === null ? 1 : null,
    error,
    at: new Date(Date.UTC(2026, 10, 12, 10, minute)),
  };
}

afterEach(async () => {
  lines.length = 0;
  for (const repository of open.splice(0)) await repository.close();
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true });
  }
});

describe("SqliteNotebookRepository", () => {
  it("round-trips a notebook", async () => {
    const repository = await memoryRepository();
    await repository.save(priceNotebook("prices"));
    const loaded = (await repository.load("prices"))!;
    expect(loaded.sources()).toEqual(priceNotebook("prices").sources());
    expect(loaded.run("total(3)")).toMatchObject({ value: 144 });
    expect(loaded.definitions().find((d) => d.name === "subtotal")?.value).toBe(
      80,
    );
  });

  it("returns undefined for an unknown name and an empty notebook for a created one", async () => {
    const repository = await memoryRepository();
    expect(await repository.load("nothing")).toBeUndefined();
    await repository.create("fresh");
    expect((await repository.load("fresh"))?.definitions()).toEqual([]);
  });

  it("keeps two notebooks apart", async () => {
    const repository = await memoryRepository();
    await repository.save(priceNotebook("prices"));
    const other = new Notebook("other");
    other.run("x = 1");
    await repository.create("other");
    await repository.save(other);
    expect((await repository.load("prices"))?.sources()).toEqual(
      priceNotebook("prices").sources(),
    );
    await repository.appendEvaluation(record("1 + 1", 0));
    await repository.appendEvaluation(record("2 + 2", 1, null, "other"));
    expect(await repository.names()).toEqual(["other", "prices"]);
    expect((await repository.load("other"))?.sources()).toEqual(["x = 1"]);
    expect(
      (
        await repository.history("prices", { limit: 10, failedOnly: false })
      ).map((r) => r.source),
    ).toEqual(["1 + 1"]);
  });

  it("lists every notebook sorted, saved or not", async () => {
    const repository = await memoryRepository();
    await repository.create("beta");
    await repository.create("alpha");
    await repository.save(new Notebook("beta"));
    expect(await repository.names()).toEqual(["alpha", "beta", "prices"]);
  });

  it("refuses a taken name on create", async () => {
    const repository = await memoryRepository();
    await expect(repository.create("prices")).rejects.toThrow(DuplicateError);
  });

  it("refuses to save or append to a notebook that does not exist", async () => {
    const repository = await memoryRepository();
    await expect(repository.save(new Notebook("ghost"))).rejects.toThrow(
      StorageError,
    );
    await expect(
      repository.appendEvaluation(record("1", 0, null, "ghost")),
    ).rejects.toThrow(StorageError);
    expect(await repository.names()).toEqual(["prices"]);
  });

  it("drops a notebook with its rows and leaves the others", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mathbook-"));
    folders.push(folder);
    const path = join(folder, "notebook.db");
    const repository = new SqliteNotebookRepository(path, logger);
    await repository.open();
    open.push(repository);
    for (const name of ["prices", "other"]) {
      await repository.create(name);
      await repository.save(priceNotebook(name));
      await repository.appendEvaluation(record("1 + 1", 0, null, name));
    }
    await repository.drop("prices");
    expect(await repository.names()).toEqual(["other"]);
    expect(await repository.load("prices")).toBeUndefined();
    const raw = new Database(path);
    const count = (table: string) =>
      (
        raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
          n: number;
        }
      ).n;
    expect(count("definitions")).toBe(4);
    expect(count("dependencies")).toBe(3);
    expect(count("evaluations")).toBe(1);
    raw.close();
    expect(
      await repository.history("other", { limit: 10, failedOnly: false }),
    ).toHaveLength(1);
    await expect(repository.drop("prices")).rejects.toThrow(NotFoundError);
  });

  it("renames a notebook and keeps its definitions and history", async () => {
    const repository = await memoryRepository();
    await repository.save(priceNotebook("prices"));
    await repository.appendEvaluation(record("1 + 1", 0));
    await repository.rename("prices", "costs");
    expect(await repository.load("prices")).toBeUndefined();
    expect((await repository.load("costs"))?.sources()).toEqual(
      priceNotebook("costs").sources(),
    );
    const history = await repository.history("costs", {
      limit: 10,
      failedOnly: false,
    });
    expect(history.map((r) => [r.notebook, r.source])).toEqual([
      ["costs", "1 + 1"],
    ]);
  });

  it("refuses to rename a missing notebook or onto a taken name", async () => {
    const repository = await memoryRepository();
    await repository.create("other");
    await expect(repository.rename("prices", "other")).rejects.toThrow(
      DuplicateError,
    );
    await expect(repository.rename("ghost", "new")).rejects.toThrow(
      NotFoundError,
    );
    expect(await repository.names()).toEqual(["other", "prices"]);
  });

  it("clears the history of one notebook and counts the records", async () => {
    const repository = await memoryRepository();
    await repository.create("other");
    await repository.save(priceNotebook("prices"));
    await repository.appendEvaluation(record("a", 0));
    await repository.appendEvaluation(record("b", 1));
    await repository.appendEvaluation(record("c", 2, null, "other"));
    expect(await repository.clearHistory("prices")).toBe(2);
    expect(await repository.clearHistory("prices")).toBe(0);
    const query = { limit: 10, failedOnly: false };
    expect(await repository.history("prices", query)).toEqual([]);
    expect(await repository.history("other", query)).toHaveLength(1);
    expect((await repository.load("prices"))?.sources()).toHaveLength(4);
    await expect(repository.clearHistory("ghost")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("replaces the stored definitions on save", async () => {
    const repository = await memoryRepository();
    await repository.save(priceNotebook("prices"));
    const smaller = new Notebook("prices");
    smaller.run("rate = 0.5");
    await repository.save(smaller);
    expect((await repository.load("prices"))?.sources()).toEqual([
      "rate = 0.5",
    ]);
  });

  it("returns history newest first, limited", async () => {
    const repository = await memoryRepository();
    for (const [index, source] of ["a", "b", "c"].entries()) {
      await repository.appendEvaluation(record(source, index));
    }
    const history = await repository.history("prices", {
      limit: 2,
      failedOnly: false,
    });
    expect(history.map((r) => r.source)).toEqual(["c", "b"]);
    expect(history[0]!.at).toEqual(new Date(Date.UTC(2026, 10, 12, 10, 2)));
  });

  it("orders records sharing a timestamp by insertion, newest first", async () => {
    const repository = await memoryRepository();
    for (const source of ["a", "b", "c"]) {
      await repository.appendEvaluation(record(source, 0));
    }
    const history = await repository.history("prices", {
      limit: 10,
      failedOnly: false,
    });
    expect(history.map((r) => r.source)).toEqual(["c", "b", "a"]);
  });

  it.each([
    ["an unknown kind", "UPDATE evaluations SET kind = 'bogus'"],
    [
      "an unknown error stage",
      "UPDATE evaluations SET error_stage = 'bogus', error_message = 'x'",
    ],
    [
      "an error stage without a message",
      "UPDATE evaluations SET error_stage = 'domain', error_message = NULL",
    ],
    [
      "an error message without a stage",
      "UPDATE evaluations SET error_stage = NULL, error_message = 'x'",
    ],
  ])("raises StorageError for a stored row with %s", async (_label, update) => {
    const folder = await mkdtemp(join(tmpdir(), "mathbook-"));
    folders.push(folder);
    const path = join(folder, "notebook.db");
    const repository = new SqliteNotebookRepository(path, logger);
    await repository.open();
    open.push(repository);
    await repository.create("prices");
    await repository.appendEvaluation(record("1 + 1", 0));
    const raw = new Database(path);
    raw.prepare(update).run();
    raw.close();
    await expect(
      repository.history("prices", { limit: 10, failedOnly: false }),
    ).rejects.toThrow(StorageError);
  });

  it("filters history to failures and restores the error", async () => {
    const repository = await memoryRepository();
    await repository.appendEvaluation(record("1 + 1", 0));
    await repository.appendEvaluation(
      record("1 / 0", 1, { stage: "evaluation", message: "Division by zero" }),
    );
    await repository.appendEvaluation(record("2 + 2", 2));
    const failed = await repository.history("prices", {
      limit: 10,
      failedOnly: true,
    });
    expect(failed).toEqual([
      record("1 / 0", 1, { stage: "evaluation", message: "Division by zero" }),
    ]);
  });

  it("stores a null result and a definition kind", async () => {
    const repository = await memoryRepository();
    await repository.appendEvaluation({
      ...record("f(x) = x", 0),
      kind: "definition",
      result: null,
    });
    const [stored] = await repository.history("prices", {
      limit: 1,
      failedOnly: false,
    });
    expect(stored).toMatchObject({ kind: "definition", result: null });
  });

  it("raises StorageError for a stored definition that does not parse", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mathbook-"));
    folders.push(folder);
    const path = join(folder, "nested", "notebook.db");
    const repository = new SqliteNotebookRepository(path, logger);
    await repository.open();
    open.push(repository);
    await repository.create("prices");
    await repository.save(priceNotebook("prices"));
    const raw = new Database(path);
    raw
      .prepare("UPDATE definitions SET source = ? WHERE name = ?")
      .run("rate = = 1", "rate");
    raw.close();
    await expect(repository.load("prices")).rejects.toThrow(StorageError);
  });

  it("writes and cascades dependency rows", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mathbook-"));
    folders.push(folder);
    const path = join(folder, "notebook.db");
    const repository = new SqliteNotebookRepository(path, logger);
    await repository.open();
    open.push(repository);
    await repository.create("prices");
    await repository.save(priceNotebook("prices"));
    const raw = new Database(path);
    const count = () =>
      (
        raw.prepare("SELECT count(*) AS n FROM dependencies").get() as {
          n: number;
        }
      ).n;
    expect(count()).toBe(3);
    raw.prepare("DELETE FROM definitions WHERE name = 'subtotal'").run();
    expect(count()).toBe(2);
    raw.close();
  });

  it("logs BEGIN and COMMIT around a save", async () => {
    const repository = await memoryRepository();
    lines.length = 0;
    await repository.save(priceNotebook("prices"));
    const begin = lines.findIndex((line) => line.includes("BEGIN"));
    const commit = lines.findIndex((line) => line.includes("COMMIT"));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(commit).toBeGreaterThan(begin);
    expect(lines.every((line) => line.startsWith("[debug] "))).toBe(true);
  });
});
