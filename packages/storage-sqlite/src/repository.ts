import {
  Notebook,
  StorageError,
  type ErrorStage,
  type EvaluationRecord,
  type HistoryQuery,
  type NotebookRepository,
} from "@mathbook/notebook";
import type { Logger } from "@mathbook/logging";
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
import { definitions, dependencies, evaluations, notebooks } from "./tables.js";

const memory = ":memory:";
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

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
      .where(isNotNull(notebooks.savedAt))
      .orderBy(asc(notebooks.id))
      .all()
      .map((row) => row.name);
  }

  /** @throws {StorageError} when the stored definitions do not make a valid notebook. */
  async load(name: string): Promise<Notebook> {
    const db = this.opened();
    const rows = db
      .select({ source: definitions.source })
      .from(definitions)
      .innerJoin(notebooks, eq(definitions.notebookId, notebooks.id))
      .where(eq(notebooks.name, name))
      .orderBy(asc(definitions.position))
      .all();
    return Notebook.restore(
      name,
      rows.map((row) => row.source),
    );
  }

  async save(notebook: Notebook): Promise<void> {
    const db = this.opened();
    db.transaction((tx) => {
      const notebookId = this.notebookId(tx, notebook.name);
      tx.update(notebooks)
        .set({ savedAt: new Date() })
        .where(eq(notebooks.id, notebookId))
        .run();
      tx.delete(definitions)
        .where(eq(definitions.notebookId, notebookId))
        .run();
      const views = notebook.definitions();
      const sources = notebook.sources();
      const ids = new Map<string, number>();
      views.forEach((view, position) => {
        const row = tx
          .insert(definitions)
          .values({
            notebookId,
            name: view.name,
            source: sources[position]!,
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

  async appendEvaluation(record: EvaluationRecord): Promise<void> {
    const db = this.opened();
    db.transaction((tx) => {
      tx.insert(evaluations)
        .values({
          notebookId: this.notebookId(tx, record.notebook),
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

  private notebookId(
    tx: Pick<BetterSQLite3Database, "insert" | "select">,
    name: string,
  ): number {
    tx.insert(notebooks).values({ name }).onConflictDoNothing().run();
    return tx
      .select({ id: notebooks.id })
      .from(notebooks)
      .where(eq(notebooks.name, name))
      .get()!.id;
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
