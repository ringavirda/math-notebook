import type { Logger } from "@mathbook/logging";
import {
  Notebook,
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
import { MongoNotebookRepository } from "../src/index.js";

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
});

afterEach(async () => {
  await repository.close();
});

describe("MongoNotebookRepository", () => {
  it("loads an empty notebook for an unknown name", async () => {
    const notebook = await repository.load("fresh");
    expect(notebook.name).toBe("fresh");
    expect(notebook.definitions()).toEqual([]);
  });

  it("saves a notebook and loads it back with its values", async () => {
    await repository.save(priced());
    const loaded = await repository.load("main");
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
    expect((await repository.load("main")).sources()).toEqual(["x = 1"]);
    expect(await repository.names()).toEqual(["main"]);
  });

  it("lists notebook names in order", async () => {
    await repository.save(new Notebook("beta"));
    await repository.save(new Notebook("alpha"));
    expect(await repository.names()).toEqual(["alpha", "beta"]);
  });

  it("keeps notebooks apart", async () => {
    await repository.save(priced());
    const other = new Notebook("other");
    other.run("y = 2");
    await repository.save(other);
    expect((await repository.load("other")).sources()).toEqual(["y = 2"]);
    expect((await repository.load("main")).sources()).toHaveLength(3);
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
    await expect(repository.load("broken")).rejects.toBeInstanceOf(
      StorageError,
    );
  });

  it("uses the database named in the url, mathbook by default", async () => {
    url = server.getUri();
    const bare = new MongoNotebookRepository(url, logger);
    await bare.open();
    await bare.save(new Notebook("main"));
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
      await multi.save(new Notebook("main"));
      const names = await raw((client) =>
        client.db("multi-host").collection("notebooks").distinct("name"),
      );
      expect(names).toEqual(["main"]);
    } finally {
      await multi.close();
    }
  });

  it("rejects use before open", async () => {
    const closed = new MongoNotebookRepository(url, logger);
    await expect(closed.names()).rejects.toThrow("not open");
  });
});
