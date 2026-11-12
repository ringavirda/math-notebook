import { type EventBus } from "@mathbook/events";
import { logged, type HasLogger, type Logger } from "@mathbook/logging";
import { MathError, parse } from "@mathbook/interpreter";
import { DomainError, type ErrorStage } from "./errors.js";
import type { NotebookEvent } from "./events.js";
import type { DefinitionView, RunResult } from "./notebook.js";
import type {
  Clock,
  EvaluationRecord,
  HistoryQuery,
  NotebookRepository,
} from "./ports.js";

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

/** The use cases of the notebook app; each call works on one notebook, loaded and saved by name. */
export class NotebookService implements HasLogger {
  constructor(
    private readonly repository: NotebookRepository,
    private readonly events: EventBus<NotebookEvent>,
    readonly logger: Logger,
    private readonly clock: Clock,
  ) {}

  /**
   * Runs one line in a notebook. The evaluation is recorded in the history whether it succeeds or
   * fails. A definition is saved; then `defined` and a `recomputed` per changed variable are
   * published. An expression publishes `evaluated`. A failure publishes `failed` and is rethrown.
   * @throws {MathError} when the line fails an interpreter stage.
   * @throws {DomainError} when a definition would break a definition that uses it.
   * @throws {StorageError} when the notebook cannot be read.
   */
  @logged
  async run(notebook: string, line: string): Promise<RunResult> {
    const loaded = await this.repository.load(notebook);
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
   * @throws {NotFoundError} when the name is not defined.
   * @throws {DependencyError} when another definition uses it.
   */
  @logged
  async remove(notebook: string, name: string): Promise<void> {
    const loaded = await this.repository.load(notebook);
    loaded.remove(name);
    await this.repository.save(loaded);
    this.events.publish({ type: "removed", notebook, name });
  }

  /** @returns the names of the saved notebooks. */
  @logged
  async list(): Promise<readonly string[]> {
    return this.repository.names();
  }

  /** @returns the notebook's definitions; empty for an unknown notebook. */
  @logged
  async show(notebook: string): Promise<readonly DefinitionView[]> {
    return (await this.repository.load(notebook)).definitions();
  }

  /**
   * @returns the definitions `name` uses and the ones that use it, transitive, in dependency order.
   * @throws {NotFoundError} when the name is not defined.
   */
  @logged
  async dependencies(
    notebook: string,
    name: string,
  ): Promise<{ uses: string[]; usedBy: string[] }> {
    const loaded = await this.repository.load(notebook);
    return {
      uses: loaded.dependencies(name),
      usedBy: loaded.dependents(name),
    };
  }

  /** @returns the notebook's evaluations, newest first. */
  @logged
  async history(
    notebook: string,
    query: HistoryQuery,
  ): Promise<readonly EvaluationRecord[]> {
    return this.repository.history(notebook, query);
  }
}
