import "reflect-metadata";
import { ConfigError, createHostBuilder } from "@mathbook/hosting";
import { addNotebook } from "@mathbook/notebook-setup";
import { CONFIG, configSchema } from "./config.js";
import { HTTP_SERVICE, addServices } from "./services.js";

try {
  const builder = addNotebook(
    createHostBuilder()
      .configuration(CONFIG, configSchema)
      .logging({ level: "info" }),
    CONFIG,
  ).hosted(HTTP_SERVICE);
  addServices(builder.services);
  process.exitCode = await builder.build().run();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
