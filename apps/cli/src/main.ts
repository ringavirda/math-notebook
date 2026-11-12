import "reflect-metadata";
import { ConfigError } from "@mathbook/config";
import { createHostBuilder } from "@mathbook/host";
import { runApp } from "./app.js";
import { CONFIG, configSchema } from "./config.js";
import { REPOSITORY_SERVICE, addServices } from "./services.js";

try {
  const builder = createHostBuilder()
    .configuration(CONFIG, configSchema)
    .logging()
    .hosted(REPOSITORY_SERVICE);
  addServices(builder.services);
  process.exitCode = await builder.build().run(runApp);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
