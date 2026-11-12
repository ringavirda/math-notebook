import { DuplicateError, NotFoundError, StorageError } from "./model/errors.js";
import { Notebook } from "./model/notebook.js";
import type {
  EvaluationRecord,
  HistoryQuery,
  NotebookRepository,
} from "./services/ports.js";

/** A repository that keeps notebooks and history in memory, for tests. */
export class MemoryNotebookRepository implements NotebookRepository {
  private readonly sources = new Map<string, readonly string[]>();
  private records: EvaluationRecord[] = [];

  async open(): Promise<void> {}

  async close(): Promise<void> {}

  async names(): Promise<readonly string[]> {
    return [...this.sources.keys()].sort();
  }

  async load(name: string): Promise<Notebook | undefined> {
    const stored = this.sources.get(name);
    return stored === undefined ? undefined : Notebook.restore(name, stored);
  }

  async create(name: string): Promise<void> {
    if (this.sources.has(name))
      throw new DuplicateError(`Notebook '${name}' exists`);
    this.sources.set(name, []);
  }

  async drop(name: string): Promise<void> {
    this.existing(name);
    this.sources.delete(name);
    this.records = this.records.filter((record) => record.notebook !== name);
  }

  async rename(from: string, to: string): Promise<void> {
    const stored = this.existing(from);
    if (this.sources.has(to))
      throw new DuplicateError(`Notebook '${to}' exists`);
    this.sources.delete(from);
    this.sources.set(to, stored);
    this.records = this.records.map((record) =>
      record.notebook === from ? { ...record, notebook: to } : record,
    );
  }

  async clearHistory(name: string): Promise<number> {
    this.existing(name);
    const before = this.records.length;
    this.records = this.records.filter((record) => record.notebook !== name);
    return before - this.records.length;
  }

  async save(notebook: Notebook): Promise<void> {
    this.missing(notebook.name);
    this.sources.set(notebook.name, notebook.sources());
  }

  async appendEvaluation(record: EvaluationRecord): Promise<void> {
    this.missing(record.notebook);
    this.records.push(record);
  }

  async history(
    name: string,
    query: HistoryQuery,
  ): Promise<readonly EvaluationRecord[]> {
    return this.records
      .filter(
        (record) =>
          record.notebook === name && (!query.failedOnly || record.error),
      )
      .reverse()
      .slice(0, query.limit);
  }

  private existing(name: string): readonly string[] {
    const stored = this.sources.get(name);
    if (stored === undefined) throw new NotFoundError(`No notebook '${name}'`);
    return stored;
  }

  private missing(name: string): void {
    if (!this.sources.has(name)) {
      throw new StorageError(`notebook '${name}'`, "no such notebook");
    }
  }
}
