import {
  DuplicateError,
  Notebook,
  NotFoundError,
  StorageError,
  type ErrorStage,
  type EvaluationRecord,
  type HistoryQuery,
  type NotebookRepository,
} from "@mathbook/notebook";
import type { Logger } from "@mathbook/common";
import Database from "better-sqlite3";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { definitions, dependencies, evaluations, notebooks } from "../schema/tables.js";

const memory = ":memory:";
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Keeps notebooks and history in SQLite tables, written through Drizzle. */
export class SqliteNotebookRepository implements NotebookRepository {
  private database: Database.Database | undefined;
  private db: BetterSQLite3Database | undefined;

  /**
   * @param path the database file, or `:memory:`; nothing is opened until `open`.
   * @param logger receives every SQL statement, including `BEGIN` and `COMMIT`, at debug.
   */
  constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  /** Makes the folder, opens the file and applies the pending migrations. */
  async open(): Promise<void> {
    if (this.path !== memory) {
      await mkdir(dirname(this.path), { recursive: true });
    }
    const database = new Database(this.path, {
      verbose: (statement) => this.logger.debug(String(statement)),
    });
    try {
      const db = drizzle(database);
      migrate(db, { migrationsFolder });
      this.database = database;
      this.db = db;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.database?.close();
    this.database = undefined;
    this.db = undefined;
  }

  async names(): Promise<readonly string[]> {
    return this.opened()
      .select({ name: notebooks.name })
      .from(notebooks)
      .orderBy(asc(notebooks.name))
      .all()
      .map((row) => row.name);
  }

  async exists(name: string): Promise<boolean> {
    return this.findId(this.opened(), name) !== undefined;
  }

  /** @throws {StorageError} when the stored definitions do not make a valid notebook. */
  async load(name: string): Promise<Notebook | undefined> {
    const db = this.opened();
    const found = db
      .select({ id: notebooks.id })
      .from(notebooks)
      .where(eq(notebooks.name, name))
      .get();
    if (found === undefined) {
      return undefined;
    }
    const rows = db
      .select({ source: definitions.source })
      .from(definitions)
      .where(eq(definitions.notebookId, found.id))
      .orderBy(asc(definitions.position))
      .all();
    return Notebook.restore(
      name,
      rows.map((row) => row.source),
    );
  }

  /** @throws {DuplicateError} when the name is taken. */
  async create(name: string): Promise<void> {
    const db = this.opened();
    db.transaction((tx) => {
      if (this.findId(tx, name) !== undefined) {
        throw new DuplicateError(`Notebook '${name}' exists`);
      }
      tx.insert(notebooks).values({ name }).run();
    });
  }

  /** @throws {NotFoundError} when no notebook has the name. */
  async drop(name: string): Promise<void> {
    const db = this.opened();
    db.transaction((tx) => {
      const notebookId = this.existingId(tx, name);
      tx.delete(evaluations)
        .where(eq(evaluations.notebookId, notebookId))
        .run();
      tx.delete(definitions)
        .where(eq(definitions.notebookId, notebookId))
        .run();
      tx.delete(notebooks).where(eq(notebooks.id, notebookId)).run();
    });
  }

  /**
   * @throws {NotFoundError} when no notebook is called `from`.
   * @throws {DuplicateError} when `to` is taken.
   */
  async rename(from: string, to: string): Promise<void> {
    const db = this.opened();
    db.transaction((tx) => {
      const notebookId = this.existingId(tx, from);
      if (this.findId(tx, to) !== undefined) {
        throw new DuplicateError(`Notebook '${to}' exists`);
      }
      tx.update(notebooks)
        .set({ name: to })
        .where(eq(notebooks.id, notebookId))
        .run();
    });
  }

  /** @throws {NotFoundError} when no notebook has the name. */
  async clearHistory(name: string): Promise<number> {
    const db = this.opened();
    return db.transaction((tx) => {
      const notebookId = this.existingId(tx, name);
      return tx
        .delete(evaluations)
        .where(eq(evaluations.notebookId, notebookId))
        .run().changes;
    });
  }

  /** @throws {StorageError} when the notebook does not exist. */
  async save(notebook: Notebook): Promise<void> {
    const db = this.opened();
    db.transaction((tx) => {
      const notebookId = this.storedId(tx, notebook.name);
      tx.update(notebooks)
        .set({ savedAt: new Date() })
        .where(eq(notebooks.id, notebookId))
        .run();
      tx.delete(definitions)
        .where(eq(definitions.notebookId, notebookId))
        .run();
      const views = notebook.definitions();
      const ids = new Map<string, number>();
      views.forEach((view, position) => {
        const row = tx
          .insert(definitions)
          .values({
            notebookId,
            name: view.name,
            source: view.source,
            position,
          })
          .returning({ id: definitions.id })
          .get();
        ids.set(view.name, row.id);
      });
      for (const view of views) {
        for (const used of view.dependsOn) {
          tx.insert(dependencies)
            .values({
              definitionId: ids.get(view.name)!,
              dependsOnId: ids.get(used)!,
            })
            .run();
        }
      }
    });
  }

  /** @throws {StorageError} when the notebook does not exist. */
  async appendEvaluation(record: EvaluationRecord): Promise<void> {
    const db = this.opened();
    db.transaction((tx) => {
      tx.insert(evaluations)
        .values({
          notebookId: this.storedId(tx, record.notebook),
          source: record.source,
          kind: record.kind,
          result: record.result,
          errorStage: record.error?.stage ?? null,
          errorMessage: record.error?.message ?? null,
          at: record.at,
        })
        .run();
    });
  }

  async history(
    name: string,
    query: HistoryQuery,
  ): Promise<readonly EvaluationRecord[]> {
    const rows = this.opened()
      .select()
      .from(evaluations)
      .innerJoin(notebooks, eq(evaluations.notebookId, notebooks.id))
      .where(
        and(
          eq(notebooks.name, name),
          query.failedOnly ? isNotNull(evaluations.errorStage) : undefined,
        ),
      )
      .orderBy(desc(evaluations.at), desc(evaluations.id))
      .limit(query.limit)
      .all();
    return rows.map(({ evaluations: row }) => ({
      notebook: name,
      source: row.source,
      kind: toKind(row.kind),
      result: row.result,
      error: toError(row.errorStage, row.errorMessage),
      at: row.at,
    }));
  }

  private findId(
    tx: Pick<BetterSQLite3Database, "select">,
    name: string,
  ): number | undefined {
    return tx
      .select({ id: notebooks.id })
      .from(notebooks)
      .where(eq(notebooks.name, name))
      .get()?.id;
  }

  private existingId(
    tx: Pick<BetterSQLite3Database, "select">,
    name: string,
  ): number {
    const id = this.findId(tx, name);
    if (id === undefined) {
      throw new NotFoundError(`No notebook '${name}'`);
    }
    return id;
  }

  private storedId(
    tx: Pick<BetterSQLite3Database, "select">,
    name: string,
  ): number {
    const id = this.findId(tx, name);
    if (id === undefined) {
      throw new StorageError(`notebook '${name}'`, "no such notebook");
    }
    return id;
  }

  private opened(): BetterSQLite3Database {
    if (this.db === undefined) {
      throw new Error("open() was not called");
    }
    return this.db;
  }
}

const stages: readonly ErrorStage[] = [
  "lexical",
  "syntax",
  "semantic",
  "evaluation",
  "domain",
];

function toStage(value: string): ErrorStage {
  const stage = stages.find((candidate) => candidate === value);
  if (stage === undefined) {
    throw new StorageError("evaluations", `unknown error stage '${value}'`);
  }
  return stage;
}

function toKind(value: string): EvaluationRecord["kind"] {
  if (value !== "expression" && value !== "definition") {
    throw new StorageError("evaluations", `unknown kind '${value}'`);
  }
  return value;
}

function toError(
  stage: string | null,
  message: string | null,
): EvaluationRecord["error"] {
  if (stage === null && message === null) {
    return null;
  }
  if (stage === null || message === null) {
    throw new StorageError(
      "evaluations",
      "error_stage and error_message must be set together",
    );
  }
  return { stage: toStage(stage), message };
}
