/** The lowest level a logger writes, lowest first. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Receives diagnostic messages; each method writes at its own level. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const order: LogLevel[] = ["debug", "info", "warn", "error"];

/** Writes `[<level>] <message>` lines at or above a level, to stderr by default. */
export class StderrLogger implements Logger {
  /**
   * @param level the lowest level that is written.
   * @param write receives each finished line, without a line break.
   */
  constructor(
    private readonly level: LogLevel,
    private readonly write: (line: string) => void = (line) =>
      process.stderr.write(line + "\n"),
  ) {}

  debug(message: string): void {
    this.log("debug", message);
  }

  info(message: string): void {
    this.log("info", message);
  }

  warn(message: string): void {
    this.log("warn", message);
  }

  error(message: string): void {
    this.log("error", message);
  }

  private log(level: LogLevel, message: string): void {
    if (order.indexOf(level) >= order.indexOf(this.level)) {
      this.write(`[${level}] ${message}`);
    }
  }
}
