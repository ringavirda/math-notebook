import {
  type Host,
  type HostOptions,
  createHostBuilder,
} from "@mathbook/hosting";
import { addNotebook } from "@mathbook/notebook-setup";
import { CONFIG, configSchema } from "./config.js";
import { HTTP_SERVICE, addServices } from "./services.js";

/**
 * Composes the API host: the notebook with its repository, then the HTTP front end, so the
 * front end stops first.
 * @param options argument list and environment, as for `createHostBuilder`.
 * @throws {ConfigError} when a setting holds a bad value.
 */
export function createApi(options?: HostOptions): Host {
  const builder = addNotebook(
    createHostBuilder(options)
      .configuration(CONFIG, configSchema)
      .logging({ level: "info" }),
    CONFIG,
  ).hosted(HTTP_SERVICE);
  addServices(builder.services);
  return builder.build();
}
