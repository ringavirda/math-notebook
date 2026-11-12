import "reflect-metadata";
import { ConfigError } from "@mathbook/hosting";
import { createApi } from "./app.js";

try {
  process.exitCode = await createApi().run();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
