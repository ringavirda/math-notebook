import type { Stage } from "@mathbook/interpreter";

/** Where an error came from: an interpreter stage, or the notebook's own rules. */
export type ErrorStage = Stage | "domain";

/** Base of the notebook's own refusals, as opposed to errors in the input line. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A name the notebook does not define, or a notebook that does not exist. */
export class NotFoundError extends DomainError {}

/** A change refused because other definitions use the one being changed. */
export class DependencyError extends DomainError {}

/** A notebook name that is already taken. */
export class DuplicateError extends DomainError {}

/** A notebook name that does not match `^[A-Za-z_][A-Za-z0-9_-]*$`. */
export class InvalidNameError extends DomainError {}

/** Stored notebook data that cannot be read or is invalid. */
export class StorageError extends Error {
  /**
   * @param where what was being read, such as a table or a notebook name.
   * @param detail what is wrong with it.
   */
  constructor(where: string, detail: string) {
    super(`Cannot read ${where}: ${detail}`);
    this.name = "StorageError";
  }
}
