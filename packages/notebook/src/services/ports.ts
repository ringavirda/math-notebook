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
  /** Names of every notebook, sorted. */
  names(): Promise<readonly string[]>;
  /**
   * @returns the stored notebook, empty when it has no definitions; `undefined` when no notebook
   * has the name.
   * @throws {StorageError} when the stored data is unreadable or invalid.
   */
  load(name: string): Promise<Notebook | undefined>;
  /**
   * Makes an empty notebook.
   * @throws {DuplicateError} when the name is taken.
   */
  create(name: string): Promise<void>;
  /**
   * Removes the notebook with its definitions and history; other notebooks are untouched.
   * @throws {NotFoundError} when no notebook has the name.
   */
  drop(name: string): Promise<void>;
  /**
   * Renames the notebook; its definitions and history go with it.
   * @throws {NotFoundError} when no notebook is called `from`.
   * @throws {DuplicateError} when `to` is taken.
   */
  rename(from: string, to: string): Promise<void>;
  /**
   * Removes the notebook's history; its definitions stay.
   * @returns how many records were removed.
   * @throws {NotFoundError} when no notebook has the name.
   */
  clearHistory(name: string): Promise<number>;
  /**
   * Replaces the stored definitions of the notebook.
   * @throws {StorageError} when the notebook does not exist.
   */
  save(notebook: Notebook): Promise<void>;
  /**
   * Adds one record to the notebook's history.
   * @throws {StorageError} when the notebook does not exist.
   */
  appendEvaluation(record: EvaluationRecord): Promise<void>;
  /** @returns the notebook's records, newest first, filtered and limited by `query`. */
  history(
    name: string,
    query: HistoryQuery,
  ): Promise<readonly EvaluationRecord[]>;
}
