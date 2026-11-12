import { Container } from "inversify";
import { CLI, Executor } from "@mathbook/cli";
import { LOGGER } from "@mathbook/hosting";
import { MathCommands } from "./commands/commands.js";
import { createExecutor } from "./commands/executor.js";

/**
 * Binds the command line front end; the host's `LOGGER` and the notebook's bindings must be
 * bound before anything is resolved. Nothing is created until it is asked for.
 * @param services the host builder's container.
 */
export function addServices(services: Container): void {
  services.bind(MathCommands).toSelf().inSingletonScope();
  services
    .bind(CLI)
    .toResolvedValue(() => new CLI())
    .inSingletonScope();
  services
    .bind(Executor)
    .toResolvedValue(createExecutor, [CLI, LOGGER, MathCommands])
    .inSingletonScope();
}
