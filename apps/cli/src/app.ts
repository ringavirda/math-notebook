import {
  CLI,
  Executor,
  runInteractive,
  runOnce,
  type ExitCode,
} from "@mathbook/cli";
import { type Host, LOGGER } from "@mathbook/hosting";
import type { EventBus, Logger } from "@mathbook/common";
import { describeEvent, type NotebookEvent } from "@mathbook/notebook";
import { EVENT_BUS } from "./services.js";

/**
 * Logs every notebook event at info level, then runs the arguments as one line or, with none,
 * the interactive session.
 * @param host the built host; its arguments are the words of the line.
 * @returns the exit code: 0 done, 1 the line failed, 2 it was used wrongly; 0 for a session.
 */
export async function runApp(host: Host): Promise<ExitCode> {
  const logger = host.services.get<Logger>(LOGGER);
  host.services
    .get<EventBus<NotebookEvent>>(EVENT_BUS)
    .subscribe((event) => logger.info(describeEvent(event)));
  const cli = host.services.get(CLI);
  const executor = host.services.get(Executor);
  try {
    if (host.argv.length > 0) return await runOnce(executor, host.argv);
    await runInteractive(cli, executor, {
      banner: [
        "Math notebook",
        "Type a definition or an expression, :help lists the commands.",
      ],
      goodbye: "Bye.",
      prompt: ">",
    });
    return 0;
  } finally {
    cli.close();
  }
}
