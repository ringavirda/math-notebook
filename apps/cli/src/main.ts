import "reflect-metadata";
import { ConfigError, createHostBuilder } from "@mathbook/hosting";
import { addNotebook } from "@mathbook/notebook-setup";
import { runApp } from "./app.js";
import { CONFIG, configSchema } from "./config.js";
import { addServices } from "./services.js";

try {
  const builder = addNotebook(
    createHostBuilder().configuration(CONFIG, configSchema).logging(),
    CONFIG,
  );
  addServices(builder.services);
  process.exitCode = await builder.build().run(runApp);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
