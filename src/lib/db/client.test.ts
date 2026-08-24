import { describe, expect, it } from "vitest";

import { createLocalDatabase } from "@/lib/db/client";

describe("local SQLite foundation", () => {
  it("opens an in-memory database with foreign-key enforcement enabled", () => {
    const { client } = createLocalDatabase(":memory:");

    try {
      const foreignKeys = client.pragma("foreign_keys", { simple: true });
      expect(foreignKeys).toBe(1);
    } finally {
      client.close();
    }
  });
});
