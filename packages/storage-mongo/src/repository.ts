import type { Logger } from "@mathbook/common";
import {
  Notebook,
  StorageError,
  type EvaluationRecord,
  type HistoryQuery,
  type NotebookRepository,
} from "@mathbook/notebook";
import { MongoClient, type Collection, type Db } from "mongodb";
import type { z } from "zod";
import {
  evaluationSchema,
  notebookSchema,
  type EvaluationDocument,
  type NotebookDocument,
} from "./documents.js";

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

/**
 * Keeps notebooks and history in MongoDB: a notebook is one document with its definitions
 * embedded, each evaluation is a document of its own.
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
  }

  /**
   * @throws {Error} "The repository is not open" when called before `open()` and, like every
   * method below, when called after it.
   * @throws {StorageError} when a stored document fails its schema.
   */
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

  async load(name: string): Promise<Notebook> {
    const document = await this.notebooks().findOne({ name });
    if (!document) {
      return new Notebook(name);
    }
    const where = `notebook '${name}'`;
    const stored = readBack(notebookSchema, where, document);
    return Notebook.restore(
      name,
      stored.definitions.map((definition) => definition.source),
    );
  }

  async save(notebook: Notebook): Promise<void> {
    const document: NotebookDocument = {
      name: notebook.name,
      definitions: notebook.definitions().map((definition) => ({
        name: definition.name,
        source: definition.source,
        dependsOn: [...definition.dependsOn],
      })),
    };
    await this.notebooks().replaceOne({ name: notebook.name }, document, {
      upsert: true,
    });
  }

  async appendEvaluation(record: EvaluationRecord): Promise<void> {
    const document: EvaluationDocument = {
      notebook: record.notebook,
      source: record.source,
      kind: record.kind,
      at: record.at,
      ...(record.result === null ? {} : { result: record.result }),
      ...(record.error === null ? {} : { error: record.error }),
    };
    await this.evaluations().insertOne(document);
  }

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
