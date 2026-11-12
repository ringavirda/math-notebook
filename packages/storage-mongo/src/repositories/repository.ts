import type { Logger } from "@mathbook/common";
import {
  DuplicateError,
  Notebook,
  NotFoundError,
  StorageError,
  type EvaluationRecord,
  type HistoryQuery,
  type NotebookRepository,
} from "@mathbook/notebook";
import {
  MongoClient,
  MongoServerError,
  type Collection,
  type Db,
} from "mongodb";
import type { z } from "zod";
import {
  evaluationSchema,
  notebookSchema,
  type EvaluationDocument,
  type NotebookDocument,
} from "../schema/documents.js";

const DEFAULT_DATABASE = "mathbook";

function readBack<T>(
  schema: z.ZodType<T>,
  where: string,
  document: unknown,
): T {
  const parsed = schema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = issue.path.join(".") || "document";
    throw new StorageError(where, `${field}: ${issue.message}`);
  }
  return parsed.data;
}

const DUPLICATE_KEY = 11000;

function asDuplicate(error: unknown, name: string): unknown {
  return error instanceof MongoServerError && error.code === DUPLICATE_KEY
    ? new DuplicateError(`Notebook '${name}' exists`)
    : error;
}

/**
 * Keeps notebooks and history in MongoDB: a notebook is one document with its definitions
 * embedded, each evaluation is a document of its own. Every method but `open` throws an `Error`
 * "The repository is not open" before `open()` and after `close()`.
 */
export class MongoNotebookRepository implements NotebookRepository {
  private readonly client: MongoClient;
  private database: Db | undefined;

  /**
   * @param url a `mongodb://` connection string; its path names the database, `mathbook` when
   * the path is empty.
   * @param logger receives every command sent to the server as `<command> <collection>` at debug.
   */
  constructor(
    private readonly url: string,
    logger: Logger,
  ) {
    this.client = new MongoClient(url, { monitorCommands: true });
    this.client.on("commandStarted", (event) => {
      const target: unknown = event.command[event.commandName];
      logger.debug(
        typeof target === "string"
          ? `${event.commandName} ${target}`
          : event.commandName,
      );
    });
  }

  /**
   * Connects and creates the indexes. Must be called before any other method.
   *
   * @throws the driver's connection error when the server cannot be reached.
   */
  async open(): Promise<void> {
    await this.client.connect();
    const named = /^mongodb(\+srv)?:\/\/[^/]+\/[^?]/.test(this.url);
    this.database = this.client.db(named ? undefined : DEFAULT_DATABASE);
    await this.notebooks().createIndex({ name: 1 }, { unique: true });
    await this.evaluations().createIndex({ notebook: 1, at: -1, _id: -1 });
  }

  async close(): Promise<void> {
    await this.client.close();
    this.database = undefined;
  }

  /** @throws {StorageError} when a stored document fails its schema. */
  async names(): Promise<readonly string[]> {
    const documents = await this.notebooks()
      .find({}, { projection: { name: 1 } })
      .sort({ name: 1 })
      .toArray();
    return documents.map(
      (document) =>
        readBack(notebookSchema.pick({ name: true }), "notebooks", document)
          .name,
    );
  }

  async exists(name: string): Promise<boolean> {
    return (await this.notebooks().countDocuments({ name }, { limit: 1 })) > 0;
  }

  /** @throws {StorageError} when the stored document fails its schema. */
  async load(name: string): Promise<Notebook | undefined> {
    const document = await this.notebooks().findOne({ name });
    if (!document) {
      return undefined;
    }
    const where = `notebook '${name}'`;
    const stored = readBack(notebookSchema, where, document);
    return Notebook.restore(
      name,
      stored.definitions.map((definition) => definition.source),
    );
  }

  /** @throws {DuplicateError} when the name is taken. */
  async create(name: string): Promise<void> {
    try {
      await this.notebooks().insertOne({ name, definitions: [] });
    } catch (error) {
      throw asDuplicate(error, name);
    }
  }

  /** @throws {NotFoundError} when no notebook has the name. */
  async drop(name: string): Promise<void> {
    const { deletedCount } = await this.notebooks().deleteOne({ name });
    if (deletedCount === 0) {
      throw new NotFoundError(`No notebook '${name}'`);
    }
    await this.evaluations().deleteMany({ notebook: name });
  }

  /**
   * @throws {NotFoundError} when no notebook is called `from`.
   * @throws {DuplicateError} when `to` is taken.
   */
  async rename(from: string, to: string): Promise<void> {
    let matchedCount: number;
    try {
      ({ matchedCount } = await this.notebooks().updateOne(
        { name: from },
        { $set: { name: to } },
      ));
    } catch (error) {
      throw asDuplicate(error, to);
    }
    if (matchedCount === 0) {
      throw new NotFoundError(`No notebook '${from}'`);
    }
    await this.evaluations().updateMany(
      { notebook: from },
      { $set: { notebook: to } },
    );
  }

  /** @throws {NotFoundError} when no notebook has the name. */
  async clearHistory(name: string): Promise<number> {
    if ((await this.notebooks().countDocuments({ name })) === 0) {
      throw new NotFoundError(`No notebook '${name}'`);
    }
    const { deletedCount } = await this.evaluations().deleteMany({
      notebook: name,
    });
    return deletedCount;
  }

  /** @throws {StorageError} when the notebook does not exist. */
  async save(notebook: Notebook): Promise<void> {
    const document: NotebookDocument = {
      name: notebook.name,
      definitions: notebook.definitions().map((definition) => ({
        name: definition.name,
        source: definition.source,
        dependsOn: [...definition.dependsOn],
      })),
    };
    const { matchedCount } = await this.notebooks().replaceOne(
      { name: notebook.name },
      document,
    );
    if (matchedCount === 0) {
      throw new StorageError(`notebook '${notebook.name}'`, "no such notebook");
    }
  }

  /** @throws {StorageError} when the notebook does not exist. */
  async appendEvaluation(record: EvaluationRecord): Promise<void> {
    const document: EvaluationDocument = {
      notebook: record.notebook,
      source: record.source,
      kind: record.kind,
      at: record.at,
      ...(record.result === null ? {} : { result: record.result }),
      ...(record.error === null ? {} : { error: record.error }),
    };
    if (
      (await this.notebooks().countDocuments({ name: record.notebook })) === 0
    ) {
      throw new StorageError(
        `notebook '${record.notebook}'`,
        "no such notebook",
      );
    }
    await this.evaluations().insertOne(document);
  }

  /** @throws {StorageError} when a stored record fails its schema. */
  async history(
    name: string,
    query: HistoryQuery,
  ): Promise<readonly EvaluationRecord[]> {
    const documents = await this.evaluations()
      .find({
        notebook: name,
        ...(query.failedOnly ? { error: { $exists: true } } : {}),
      })
      .sort({ at: -1, _id: -1 })
      .limit(query.limit)
      .toArray();
    return documents.map((document) => {
      const stored = readBack(evaluationSchema, "evaluations", document);
      return {
        notebook: stored.notebook,
        source: stored.source,
        kind: stored.kind,
        result: stored.result ?? null,
        error: stored.error ?? null,
        at: stored.at,
      };
    });
  }

  private notebooks(): Collection<NotebookDocument> {
    return this.connected().collection<NotebookDocument>("notebooks");
  }

  private evaluations(): Collection<EvaluationDocument> {
    return this.connected().collection<EvaluationDocument>("evaluations");
  }

  private connected(): Db {
    if (!this.database) {
      throw new Error("The repository is not open");
    }
    return this.database;
  }
}
