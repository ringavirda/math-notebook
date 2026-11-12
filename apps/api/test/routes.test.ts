import { describe, expect, it, vi } from "vitest";
import { StorageError, type NotebookService } from "@mathbook/notebook";
import { handle } from "../src/routes.js";

describe("handle", () => {
  it("answers 500 Unexpected error and reports the cause for a storage failure", async () => {
    const cause = new StorageError("notebook main", "broken");
    const service = {
      list: async () => {
        throw cause;
      },
    } as unknown as NotebookService;
    const onUnexpected = vi.fn();
    const reply = await handle(
      service,
      { method: "GET", url: "/notebooks", body: "" },
      onUnexpected,
    );
    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({
      error: { stage: "server", message: "Unexpected error" },
    });
    expect(onUnexpected).toHaveBeenCalledWith(cause);
  });
});
