import type { ErrorStage } from "../model/errors.js";
import type { Notebook } from "../model/notebook.js";

/** Supplies the time stamped on each evaluation record. */
export type Clock = () => Date;

/** One line the user ran, kept in the notebook's history. */
export interface EvaluationRecord {
  notebook: string;
  source: string;
  /** A line that failed before it could be parsed is an `"expression"`. */
  kind: "expression" | "definition";
  /** The value of an expression or a variable; `null` for a function or a failure. */
  result: number | null;
  error: { stage: ErrorStage; message: string } | null;
  at: Date;
}

export interface HistoryQuery {
  /** At most this many records, at least 1. */
  limit: number;
  failedOnly: boolean;
}

/** Where notebooks and their history are kept. */
export interface NotebookRepository {
  /** Prepares the storage for use; call once before any other method. */
  open(): Promise<void>;
  /** Releases the storage; no other method may be called afterwards. */
  close(): Promise<void>;
  /** Names of the saved notebooks. */
  names(): Promise<readonly string[]>;
  /**
   * @returns the saved notebook, or an empty one when the name is unknown.
   * @throws {StorageError} when the stored data is unreadable or invalid.
   */
  load(name: string): Promise<Notebook>;
  /** Replaces the stored definitions of the notebook. */
  save(notebook: Notebook): Promise<void>;
  /** Adds one record to the notebook's history. */
  appendEvaluation(record: EvaluationRecord): Promise<void>;
  /** @returns the notebook's records, newest first, filtered and limited by `query`. */
  history(
    name: string,
    query: HistoryQuery,
  ): Promise<readonly EvaluationRecord[]>;
}
