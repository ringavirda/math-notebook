import type { Logger } from "@mathbook/common";
import {
  DuplicateError,
  Notebook,
  NotFoundError,
  StorageError,
  type EvaluationRecord,
} from "@mathbook/notebook";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { MongoNotebookRepository } from "../../src/index.js";

const SERVER_START_MS = 300_000;

let server: MongoMemoryServer;
let counter = 0;
let url: string;
let lines: string[];
let repository: MongoNotebookRepository;

const logger: Logger = {
  debug: (message) => lines.push(message),
  info: () => {},
  warn: () => {},
  error: () => {},
};

function priced(): Notebook {
  const notebook = new Notebook("main");
  notebook.run("rate = 0.2");
  notebook.run("price = 40");
  notebook.run("total(n) = n * price * (1 + rate)");
  return notebook;
}

function record(
  source: string,
  minute: number,
  overrides: Partial<EvaluationRecord> = {},
): EvaluationRecord {
  return {
    notebook: "main",
    source,
    kind: "expression",
    result: 1,
    error: null,
    at: new Date(Date.UTC(2026, 10, 12, 10, minute)),
    ...overrides,
  };
}

async function raw<T>(work: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(url);
  try {
    return await work(client);
  } finally {
    await client.close();
  }
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
}, SERVER_START_MS);

afterAll(async () => {
  await server.stop();
});

beforeEach(async () => {
  counter += 1;
  url = `${server.getUri()}test${counter}`;
  lines = [];
  repository = new MongoNotebookRepository(url, logger);
  await repository.open();
  await repository.create("main");
});

afterEach(async () => {
  await repository.close();
});

describe("MongoNotebookRepository", () => {
  it("loads undefined for an unknown name and an empty notebook for a created one", async () => {
    expect(await repository.load("fresh")).toBeUndefined();
    await repository.create("fresh");
    const notebook = (await repository.load("fresh"))!;
    expect(notebook.name).toBe("fresh");
    expect(notebook.definitions()).toEqual([]);
  });

  it("saves a notebook and loads it back with its values", async () => {
    await repository.save(priced());
    const loaded = (await repository.load("main"))!;
    expect(loaded.sources()).toEqual(priced().sources());
    expect(loaded.run("total(3)")).toEqual({
      kind: "expression",
      source: "total(3)",
      value: 144,
    });
  });

  it("stores definitions embedded with their dependencies", async () => {
    await repository.save(priced());
    const stored = await raw((client) =>
      client.db().collection("notebooks").findOne({}),
    );
    expect(stored).toMatchObject({
      name: "main",
      definitions: [
        { name: "rate", source: "rate = 0.2", dependsOn: [] },
        { name: "price", source: "price = 40", dependsOn: [] },
        {
          name: "total",
          source: "total(n) = n * price * (1 + rate)",
          dependsOn: ["price", "rate"],
        },
      ],
    });
  });

  it("replaces the stored definitions on save", async () => {
    await repository.save(priced());
    const smaller = new Notebook("main");
    smaller.run("x = 1");
    await repository.save(smaller);
    expect((await repository.load("main"))?.sources()).toEqual(["x = 1"]);
    expect(await repository.names()).toEqual(["main"]);
  });

  it("lists every notebook sorted, saved or not", async () => {
    await repository.create("beta");
    await repository.create("alpha");
    expect(await repository.names()).toEqual(["alpha", "beta", "main"]);
  });

  it("refuses a taken name on create", async () => {
    await expect(repository.create("main")).rejects.toThrow(DuplicateError);
  });

  it("refuses to save or append to a notebook that does not exist", async () => {
    await expect(repository.save(new Notebook("ghost"))).rejects.toThrow(
      StorageError,
    );
    await expect(
      repository.appendEvaluation(record("1", 1, { notebook: "ghost" })),
    ).rejects.toThrow(StorageError);
    expect(await repository.names()).toEqual(["main"]);
  });

  it("drops a notebook with its history and leaves the others", async () => {
    await repository.create("other");
    await repository.save(priced());
    await repository.appendEvaluation(record("1", 1));
    await repository.appendEvaluation(record("2", 2, { notebook: "other" }));
    await repository.drop("main");
    expect(await repository.names()).toEqual(["other"]);
    expect(await repository.load("main")).toBeUndefined();
    const left = await raw((client) =>
      client.db().collection("evaluations").find().toArray(),
    );
    expect(left.map((d) => d.notebook)).toEqual(["other"]);
    await expect(repository.drop("main")).rejects.toThrow(NotFoundError);
  });

  it("renames a notebook and keeps its definitions and history", async () => {
    await repository.save(priced());
    await repository.appendEvaluation(record("1", 1));
    await repository.rename("main", "costs");
    expect(await repository.load("main")).toBeUndefined();
    expect((await repository.load("costs"))?.sources()).toEqual(
      priced().sources(),
    );
    const found = await repository.history("costs", {
      limit: 10,
      failedOnly: false,
    });
    expect(found.map((r) => [r.notebook, r.source])).toEqual([["costs", "1"]]);
  });

  it("refuses to rename a missing notebook or onto a taken name", async () => {
    await repository.create("other");
    await expect(repository.rename("main", "other")).rejects.toThrow(
      DuplicateError,
    );
    await expect(repository.rename("ghost", "new")).rejects.toThrow(
      NotFoundError,
    );
    expect(await repository.names()).toEqual(["main", "other"]);
  });

  it("clears the history of one notebook and counts the records", async () => {
    await repository.create("other");
    await repository.save(priced());
    await repository.appendEvaluation(record("1", 1));
    await repository.appendEvaluation(record("2", 2));
    await repository.appendEvaluation(record("3", 3, { notebook: "other" }));
    expect(await repository.clearHistory("main")).toBe(2);
    expect(await repository.clearHistory("main")).toBe(0);
    const query = { limit: 10, failedOnly: false };
    expect(await repository.history("main", query)).toEqual([]);
    expect(await repository.history("other", query)).toHaveLength(1);
    expect((await repository.load("main"))?.sources()).toHaveLength(3);
    await expect(repository.clearHistory("ghost")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("keeps notebooks apart", async () => {
    await repository.save(priced());
    await repository.create("other");
    const other = new Notebook("other");
    other.run("y = 2");
    await repository.save(other);
    expect((await repository.load("other"))?.sources()).toEqual(["y = 2"]);
    expect((await repository.load("main"))?.sources()).toHaveLength(3);
  });

  it("returns history newest first and limited", async () => {
    await repository.appendEvaluation(record("1", 1));
    await repository.appendEvaluation(record("2", 2));
    await repository.appendEvaluation(record("3", 3));
    const found = await repository.history("main", {
      limit: 2,
      failedOnly: false,
    });
    expect(found.map((r) => r.source)).toEqual(["3", "2"]);
  });

  it("keeps the records of other notebooks out of history", async () => {
    await repository.create("other");
    await repository.appendEvaluation(record("1", 1));
    await repository.appendEvaluation(record("2", 2, { notebook: "other" }));
    const found = await repository.history("main", {
      limit: 10,
      failedOnly: false,
    });
    expect(found.map((r) => r.source)).toEqual(["1"]);
  });

  it("round-trips a failure and a definition without a result", async () => {
    const failure = record("1 +", 1, {
      result: null,
      error: { stage: "syntax", message: "Expected an operand" },
    });
    const definition = record("f(x) = x", 2, {
      kind: "definition",
      result: null,
    });
    await repository.appendEvaluation(failure);
    await repository.appendEvaluation(definition);
    const found = await repository.history("main", {
      limit: 10,
      failedOnly: false,
    });
    expect(found).toEqual([definition, failure]);
  });

  it("filters failed records only", async () => {
    await repository.appendEvaluation(record("1", 1));
    await repository.appendEvaluation(
      record("1 +", 2, {
        result: null,
        error: { stage: "syntax", message: "Expected an operand" },
      }),
    );
    await repository.appendEvaluation(record("2", 3));
    const found = await repository.history("main", {
      limit: 10,
      failedOnly: true,
    });
    expect(found.map((r) => r.source)).toEqual(["1 +"]);
  });

  it("names the field of a stored notebook that fails the schema", async () => {
    await raw((client) =>
      client
        .db()
        .collection("notebooks")
        .insertOne({ name: "bad", definitions: [{ name: "x", source: 5 }] }),
    );
    const failure = await repository.load("bad").catch((error) => error);
    expect(failure).toBeInstanceOf(StorageError);
    expect(failure.message).toContain("definitions.0.source");
  });

  it("names the field of a stored evaluation that fails the schema", async () => {
    await raw((client) =>
      client.db().collection("evaluations").insertOne({
        notebook: "main",
        source: "1",
        kind: "other",
        at: new Date(),
      }),
    );
    const failure = await repository
      .history("main", { limit: 1, failedOnly: false })
      .catch((error) => error);
    expect(failure).toBeInstanceOf(StorageError);
    expect(failure.message).toContain("kind");
  });

  it("refuses a stored definition that does not parse", async () => {
    await raw((client) =>
      client
        .db()
        .collection("notebooks")
        .insertOne({
          name: "broken",
          definitions: [{ name: "x", source: "x = +", dependsOn: [] }],
        }),
    );
    expect(await repository.exists("broken")).toBe(true);
    await expect(repository.load("broken")).rejects.toBeInstanceOf(
      StorageError,
    );
  });

  it("uses the database named in the url, mathbook by default", async () => {
    url = server.getUri();
    const bare = new MongoNotebookRepository(url, logger);
    await bare.open();
    await bare.create("main");
    await bare.close();
    const count = await raw((client) =>
      client.db("mathbook").collection("notebooks").countDocuments(),
    );
    expect(count).toBe(1);
  });

  it("logs each command with its collection at debug", async () => {
    await repository.save(priced());
    await repository.load("main");
    await repository.appendEvaluation(record("1", 1));
    await repository.history("main", { limit: 1, failedOnly: false });
    expect(lines).toEqual(
      expect.arrayContaining([
        "update notebooks",
        "find notebooks",
        "insert evaluations",
        "find evaluations",
        "createIndexes notebooks",
      ]),
    );
  });

  it("saves with a single update command", async () => {
    lines = [];
    await repository.save(priced());
    expect(lines).toEqual(["update notebooks"]);
  });

  it("orders records with the same time newest inserted first", async () => {
    await repository.appendEvaluation(record("1", 1));
    await repository.appendEvaluation(record("2", 1));
    await repository.appendEvaluation(record("3", 1));
    const found = await repository.history("main", {
      limit: 10,
      failedOnly: false,
    });
    expect(found.map((r) => r.source)).toEqual(["3", "2", "1"]);
  });

  it("keeps notebook names unique", async () => {
    await repository.save(new Notebook("main"));
    await expect(
      raw((client) =>
        client
          .db()
          .collection("notebooks")
          .insertOne({ name: "main", definitions: [] }),
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("takes the database from a multi-host URL", async () => {
    const hosts = server.getUri().replace("mongodb://", "").replace("/", "");
    const multi = new MongoNotebookRepository(
      `mongodb://${hosts},${hosts}/multi%2Dhost`,
      logger,
    );
    await multi.open();
    try {
      await multi.create("main");
      const names = await raw((client) =>
        client.db("multi-host").collection("notebooks").distinct("name"),
      );
      expect(names).toEqual(["main"]);
    } finally {
      await multi.close();
    }
  });

  it("tells whether a notebook exists", async () => {
    expect(await repository.exists("main")).toBe(true);
    expect(await repository.exists("ghost")).toBe(false);
  });

  it("rejects use after close", async () => {
    const closed = new MongoNotebookRepository(url, logger);
    await closed.open();
    await closed.close();
    await expect(closed.names()).rejects.toThrow("The repository is not open");
  });

  it("rejects use before open", async () => {
    const closed = new MongoNotebookRepository(url, logger);
    await expect(closed.names()).rejects.toThrow("not open");
  });
});
