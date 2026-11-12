import { Notebook } from "./notebook.js";
import type {
  EvaluationRecord,
  HistoryQuery,
  NotebookRepository,
} from "./ports.js";

/** A repository that keeps notebooks and history in memory, for tests. */
export class MemoryNotebookRepository implements NotebookRepository {
  private readonly sources = new Map<string, readonly string[]>();
  private readonly records: EvaluationRecord[] = [];

  async open(): Promise<void> {}

  async close(): Promise<void> {}

  async names(): Promise<readonly string[]> {
    return [...this.sources.keys()];
  }

  async load(name: string): Promise<Notebook> {
    return Notebook.restore(name, this.sources.get(name) ?? []);
  }

  async save(notebook: Notebook): Promise<void> {
    this.sources.set(notebook.name, notebook.sources());
  }

  async appendEvaluation(record: EvaluationRecord): Promise<void> {
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
}
