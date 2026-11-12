import {
  CLI,
  Executor,
  runInteractive,
  runOnce,
  type ExitCode,
} from "@mathbook/cli";
import { MathCommands } from "./commands.js";
import type { Host } from "@mathbook/hosting";

/**
 * Runs the arguments as one line or, with none, the interactive session.
 * @param host the built host; its arguments are the words of the line.
 * @returns the exit code: 0 done, 1 the line failed, 2 it was used wrongly; 0 for a session.
 */
export async function runApp(host: Host): Promise<ExitCode> {
  const cli = host.services.get(CLI);
  const executor = host.services.get(Executor);
  try {
    const commands = host.services.get(MathCommands);
    await commands.start();
    if (host.argv.length > 0) return await runOnce(executor, host.argv);
    await runInteractive(cli, executor, {
      banner: [
        "Math notebook",
        "Type a definition or an expression, :help lists the commands.",
      ],
      goodbye: "Bye.",
      prompt: () => `${commands.current}>`,
    });
    return 0;
  } finally {
    cli.close();
  }
}
