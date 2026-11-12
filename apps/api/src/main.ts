import "reflect-metadata";
import { ConfigError, LOGGER, createHostBuilder } from "@mathbook/hosting";
import type { EventBus, Logger } from "@mathbook/common";
import { describeEvent, type NotebookEvent } from "@mathbook/notebook";
import { configSchema, CONFIG } from "./config.js";
import {
  EVENT_BUS,
  HTTP_SERVICE,
  REPOSITORY_SERVICE,
  addServices,
} from "./services.js";

try {
  const builder = createHostBuilder()
    .configuration(CONFIG, configSchema)
    .logging({ level: "info" })
    .hosted(REPOSITORY_SERVICE)
    .hosted(HTTP_SERVICE);
  addServices(builder.services);
  const host = builder.build();
  const logger = host.services.get<Logger>(LOGGER);
  host.services
    .get<EventBus<NotebookEvent>>(EVENT_BUS)
    .subscribe((event) => logger.info(describeEvent(event)));
  process.exitCode = await host.run();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
