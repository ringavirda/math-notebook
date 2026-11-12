import {
  Executor,
  UsageError,
  checkArguments,
  mapErrors,
  timing,
  type CLI,
} from "@mathbook/cli";
import { MathError } from "@mathbook/interpreter";
import type { Logger } from "@mathbook/common";
import { DomainError, StorageError } from "@mathbook/notebook";
import type { MathCommands } from "./commands.js";
import { describeError } from "./format.js";

/**
 * @param cli where output and errors go.
 * @param logger where timings and unexpected errors go.
 * @param commands the commands to register; any line not starting with `:` is evaluated.
 * @returns an executor whose pipeline is `mapErrors`, `timing`, `checkArguments`, then the
 * command. A word starting with `:` that is no command is a usage error.
 */
export function createExecutor(
  cli: CLI,
  logger: Logger,
  commands: MathCommands,
): Executor {
  const executor = new Executor(cli);
  let input = "";
  executor.use(
    mapErrors(cli, logger, [MathError, DomainError, StorageError], (error) =>
      describeError(error, input),
    ),
  );
  executor.use(timing(logger));
  executor.use(checkArguments);
  for (const command of commands.list()) executor.registerCommand(command);
  executor.fallback(async (line) => {
    if (line.startsWith(":"))
      throw new UsageError(`Unknown command: ${line.split(/\s+/)[0]}`);
    input = line;
    await commands.evaluate(line);
  });
  return executor;
}
