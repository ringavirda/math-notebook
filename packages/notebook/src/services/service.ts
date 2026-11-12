import {
  type EventBus,
  type HasLogger,
  type Logger,
  logged,
} from "@mathbook/common";
import { MathError, parse } from "@mathbook/interpreter";
import {
  DomainError,
  DuplicateError,
  InvalidNameError,
  NotFoundError,
  type ErrorStage,
} from "../model/errors.js";
import type { NotebookEvent } from "../model/events.js";
import type { DefinitionView, Notebook, RunResult } from "../model/notebook.js";
import type {
  Clock,
  EvaluationRecord,
  HistoryQuery,
  NotebookRepository,
} from "./ports.js";

/** What a notebook name must match: letters, digits, `_` and `-`, not starting with a digit or `-`. */
export const notebookNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function checkName(name: string): void {
  if (!notebookNamePattern.test(name)) {
    throw new InvalidNameError(
      `Invalid notebook name '${name}': use letters, digits, _ and -, not starting with a digit or -`,
    );
  }
}

function kindOf(line: string): EvaluationRecord["kind"] {
  try {
    return parse(line).kind;
  } catch {
    return "expression";
  }
}

function stageOf(error: unknown): ErrorStage | undefined {
  if (error instanceof MathError) return error.stage;
  if (error instanceof DomainError) return "domain";
  return undefined;
}

/**
 * The use cases of the notebook app; each call works on one notebook, loaded and saved by name;
 * one that does not exist is refused. Calls that change a notebook run one after another per
 * notebook, so two at once do not overwrite each other; that holds within one process only, not
 * between processes sharing a database.
 */
export class NotebookService implements HasLogger {
  constructor(
    private readonly repository: NotebookRepository,
    private readonly events: EventBus<NotebookEvent>,
    readonly logger: Logger,
    private readonly clock: Clock,
  ) {}

  private readonly queues = new Map<string, Promise<unknown>>();

  /**
   * Runs one line in a notebook. The evaluation is recorded in the history whether it succeeds or
   * fails. A definition is saved; then `defined` and a `recomputed` per changed variable are
   * published. An expression publishes `evaluated`. A failure publishes `failed` and is rethrown.
   * @throws {MathError} when the line fails an interpreter stage.
   * @throws {DependencyError} when a definition would break a definition that uses it.
   * @throws {NotFoundError} when the notebook does not exist; nothing is recorded.
   * @throws {StorageError} when the notebook cannot be read or written.
   */
  @logged
  run(notebook: string, line: string): Promise<RunResult> {
    return this.exclusive([notebook], () => this.runLine(notebook, line));
  }

  private async runLine(notebook: string, line: string): Promise<RunResult> {
    const loaded = await this.loaded(notebook);
    let result: RunResult;
    try {
      result = loaded.run(line);
    } catch (error) {
      const stage = stageOf(error);
      if (stage === undefined) throw error;
      const message = (error as Error).message;
      await this.repository.appendEvaluation({
        notebook,
        source: line.trim(),
        kind: kindOf(line),
        result: null,
        error: { stage, message },
        at: this.clock(),
      });
      this.events.publish({
        type: "failed",
        notebook,
        source: line.trim(),
        stage,
        message,
      });
      throw error;
    }

    if (result.kind === "expression") {
      await this.repository.appendEvaluation({
        notebook,
        source: result.source,
        kind: "expression",
        result: result.value,
        error: null,
        at: this.clock(),
      });
      this.events.publish({
        type: "evaluated",
        notebook,
        source: result.source,
        value: result.value,
      });
      return result;
    }

    await this.repository.save(loaded);
    await this.repository.appendEvaluation({
      notebook,
      source: result.source,
      kind: "definition",
      result: result.definition.value ?? null,
      error: null,
      at: this.clock(),
    });
    this.events.publish({
      type: "defined",
      notebook,
      name: result.definition.name,
      source: result.source,
    });
    for (const { name, value } of result.recomputed) {
      this.events.publish({ type: "recomputed", notebook, name, value });
    }
    return result;
  }

  /**
   * @throws {NotFoundError} when the notebook does not exist or the name is not defined.
   * @throws {DependencyError} when another definition uses it.
   * @throws {StorageError} when the notebook cannot be read or written.
   */
  @logged
  remove(notebook: string, name: string): Promise<void> {
    return this.exclusive([notebook], async () => {
      const loaded = await this.loaded(notebook);
      loaded.remove(name);
      await this.repository.save(loaded);
      this.events.publish({ type: "removed", notebook, name });
    });
  }

  /**
   * Makes an empty notebook and publishes `created`.
   * @throws {InvalidNameError} when the name does not match `^[A-Za-z_][A-Za-z0-9_-]*$`.
   * @throws {DuplicateError} when the name is taken.
   */
  @logged
  create(name: string): Promise<void> {
    return this.exclusive([name], () => this.make(name));
  }

  private async make(name: string): Promise<void> {
    checkName(name);
    if (await this.repository.exists(name)) {
      throw new DuplicateError(`Notebook '${name}' exists`);
    }
    await this.repository.create(name);
    this.events.publish({ type: "created", notebook: name });
  }

  /**
   * Makes the notebook when it is missing; an existing one is left alone and publishes nothing.
   * @throws {InvalidNameError} when the notebook is missing and the name is not valid.
   */
  @logged
  ensure(name: string): Promise<void> {
    return this.exclusive([name], async () => {
      if (!(await this.repository.exists(name))) {
        await this.make(name);
      }
    });
  }

  /**
   * Removes a notebook with its definitions and history and publishes `dropped`.
   * @throws {NotFoundError} when the notebook does not exist.
   */
  @logged
  drop(notebook: string): Promise<void> {
    return this.exclusive([notebook], async () => {
      await this.assertExists(notebook);
      await this.repository.drop(notebook);
      this.events.publish({ type: "dropped", notebook });
    });
  }

  /**
   * Renames a notebook, keeping its definitions and history, and publishes `renamed`.
   * @throws {NotFoundError} when the notebook does not exist.
   * @throws {InvalidNameError} when `to` does not match `^[A-Za-z_][A-Za-z0-9_-]*$`.
   * @throws {DuplicateError} when `to` is taken.
   */
  @logged
  rename(from: string, to: string): Promise<void> {
    return this.exclusive([from, to], async () => {
      await this.assertExists(from);
      checkName(to);
      if (await this.repository.exists(to)) {
        throw new DuplicateError(`Notebook '${to}' exists`);
      }
      await this.repository.rename(from, to);
      this.events.publish({ type: "renamed", notebook: from, to });
    });
  }

  /**
   * Removes a notebook's history, keeping its definitions, and publishes `historyCleared`.
   * @returns how many records were removed.
   * @throws {NotFoundError} when the notebook does not exist.
   */
  @logged
  clearHistory(notebook: string): Promise<number> {
    return this.exclusive([notebook], async () => {
      await this.assertExists(notebook);
      const count = await this.repository.clearHistory(notebook);
      this.events.publish({ type: "historyCleared", notebook, count });
      return count;
    });
  }

  /**
   * @returns the names of every notebook, sorted.
   * @throws {StorageError} when the stored data is unreadable or invalid.
   */
  @logged
  async list(): Promise<readonly string[]> {
    return this.repository.names();
  }

  /**
   * @returns the notebook's definitions.
   * @throws {NotFoundError} when the notebook does not exist.
   * @throws {StorageError} when the stored data is unreadable or invalid.
   */
  @logged
  async show(notebook: string): Promise<readonly DefinitionView[]> {
    return (await this.loaded(notebook)).definitions();
  }

  /**
   * @returns the definitions `name` uses and the ones that use it, transitive, in dependency order.
   * @throws {NotFoundError} when the notebook does not exist or the name is not defined.
   * @throws {StorageError} when the stored data is unreadable or invalid.
   */
  @logged
  async dependencies(
    notebook: string,
    name: string,
  ): Promise<{ uses: string[]; usedBy: string[] }> {
    const loaded = await this.loaded(notebook);
    return {
      uses: loaded.dependencies(name),
      usedBy: loaded.dependents(name),
    };
  }

  /**
   * @returns the notebook's evaluations, newest first.
   * @throws {NotFoundError} when the notebook does not exist.
   * @throws {StorageError} when a stored record is unreadable or invalid.
   */
  @logged
  async history(
    notebook: string,
    query: HistoryQuery,
  ): Promise<readonly EvaluationRecord[]> {
    await this.assertExists(notebook);
    return this.repository.history(notebook, query);
  }

  private exclusive<T>(
    notebooks: readonly string[],
    work: () => Promise<T>,
  ): Promise<T> {
    const names = [...new Set(notebooks)];
    const earlier = names.flatMap((name) => this.queues.get(name) ?? []);
    const chain = Promise.allSettled(earlier).then(work);
    const release = (): void => {
      for (const name of names) {
        if (this.queues.get(name) === chain) this.queues.delete(name);
      }
    };
    for (const name of names) this.queues.set(name, chain);
    chain.then(release, release);
    return chain;
  }

  private async assertExists(notebook: string): Promise<void> {
    if (!(await this.repository.exists(notebook))) {
      throw new NotFoundError(`No notebook '${notebook}'`);
    }
  }

  private async loaded(notebook: string): Promise<Notebook> {
    const loaded = await this.repository.load(notebook);
    if (loaded === undefined) {
      throw new NotFoundError(`No notebook '${notebook}'`);
    }
    return loaded;
  }
}
