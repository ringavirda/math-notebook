/** The lowest level a logger writes, lowest first. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Receives diagnostic messages; each method writes at its own level. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
