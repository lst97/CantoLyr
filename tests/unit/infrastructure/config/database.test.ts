import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPrismaClient,
  disconnectDatabase,
  checkDatabaseConnection,
} from "../../../../src/infrastructure/config/database.js";

// Mock PrismaClient
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    $queryRaw: vi.fn(),
    $disconnect: vi.fn(),
  })),
}));

describe("Database Configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await disconnectDatabase();
  });

  describe("getPrismaClient", () => {
    it("should return a PrismaClient instance", () => {
      const client = getPrismaClient();
      expect(client).toBeDefined();
    });

    it("should return the same instance on multiple calls (singleton)", () => {
      const client1 = getPrismaClient();
      const client2 = getPrismaClient();
      expect(client1).toBe(client2);
    });
  });

  describe("checkDatabaseConnection", () => {
    it("should return true when database connection is successful", async () => {
      const client = getPrismaClient();
      vi.mocked(client.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);

      const result = await checkDatabaseConnection();
      expect(result).toBe(true);
      expect(client.$queryRaw).toHaveBeenCalledWith(["SELECT 1"]);
    });

    it("should return false when database connection fails", async () => {
      const client = getPrismaClient();
      vi.mocked(client.$queryRaw).mockRejectedValue(
        new Error("Connection failed")
      );

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await checkDatabaseConnection();
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Database connection failed:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("disconnectDatabase", () => {
    it("should call $disconnect on the client", async () => {
      const client = getPrismaClient();
      await disconnectDatabase();
      expect(client.$disconnect).toHaveBeenCalled();
    });
  });
});
