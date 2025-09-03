import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import {
  loadEnvFile,
  getRequiredEnv,
  getOptionalEnv,
  getEnvAsNumber,
  getEnvAsBoolean,
} from "../../../../src/infrastructure/config/env.js";

describe("env utilities", () => {
  const originalEnv = process.env;
  const testEnvPath = join(process.cwd(), ".env.test");

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clean up any existing test env file
    if (existsSync(testEnvPath)) {
      unlinkSync(testEnvPath);
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clean up test env file
    if (existsSync(testEnvPath)) {
      unlinkSync(testEnvPath);
    }
  });

  describe("loadEnvFile", () => {
    it("should load environment variables from .env file", () => {
      const envContent = `
# This is a comment
NODE_ENV=test
DATABASE_URL=postgresql://test:test@localhost:5432/test
PORT=4000
DEBUG=true

# Another comment
API_KEY="secret-key-with-quotes"
EMPTY_LINE_ABOVE=value
`;

      writeFileSync(join(process.cwd(), ".env"), envContent);

      loadEnvFile();

      expect(process.env["NODE_ENV"]).toBe("test");
      expect(process.env["DATABASE_URL"]).toBe(
        "postgresql://test:test@localhost:5432/test"
      );
      expect(process.env["PORT"]).toBe("4000");
      expect(process.env["DEBUG"]).toBe("true");
      expect(process.env["API_KEY"]).toBe("secret-key-with-quotes");
      expect(process.env["EMPTY_LINE_ABOVE"]).toBe("value");

      // Clean up
      unlinkSync(join(process.cwd(), ".env"));
    });

    it("should not override existing environment variables", () => {
      process.env["EXISTING_VAR"] = "original-value";

      const envContent = "EXISTING_VAR=new-value\nNEW_VAR=test-value";
      writeFileSync(join(process.cwd(), ".env"), envContent);

      loadEnvFile();

      expect(process.env["EXISTING_VAR"]).toBe("original-value");
      expect(process.env["NEW_VAR"]).toBe("test-value");

      // Clean up
      unlinkSync(join(process.cwd(), ".env"));
    });

    it("should handle missing .env file gracefully", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      loadEnvFile();

      expect(consoleSpy).toHaveBeenCalledWith(
        "No .env file found, using system environment variables"
      );
      consoleSpy.mockRestore();
    });

    it("should skip empty lines and comments", () => {
      const envContent = `
# Comment line
  # Indented comment

VALID_VAR=value
# Another comment
  
ANOTHER_VAR=another-value
`;

      writeFileSync(join(process.cwd(), ".env"), envContent);

      loadEnvFile();

      expect(process.env["VALID_VAR"]).toBe("value");
      expect(process.env["ANOTHER_VAR"]).toBe("another-value");

      // Clean up
      unlinkSync(join(process.cwd(), ".env"));
    });

    it("should handle quoted values correctly", () => {
      const envContent = `
SINGLE_QUOTED='single quoted value'
DOUBLE_QUOTED="double quoted value"
UNQUOTED=unquoted value
MIXED_QUOTES="mixed 'quotes' value"
`;

      writeFileSync(join(process.cwd(), ".env"), envContent);

      loadEnvFile();

      expect(process.env["SINGLE_QUOTED"]).toBe("single quoted value");
      expect(process.env["DOUBLE_QUOTED"]).toBe("double quoted value");
      expect(process.env["UNQUOTED"]).toBe("unquoted value");
      expect(process.env["MIXED_QUOTES"]).toBe("mixed 'quotes' value");

      // Clean up
      unlinkSync(join(process.cwd(), ".env"));
    });

    it("should handle malformed lines gracefully", () => {
      const envContent = `
VALID_VAR=value
INVALID_LINE_NO_EQUALS
=INVALID_NO_KEY
ANOTHER_VALID=another-value
`;

      writeFileSync(join(process.cwd(), ".env"), envContent);

      loadEnvFile();

      expect(process.env["VALID_VAR"]).toBe("value");
      expect(process.env["ANOTHER_VALID"]).toBe("another-value");
      expect(process.env["INVALID_LINE_NO_EQUALS"]).toBeUndefined();

      // Clean up
      unlinkSync(join(process.cwd(), ".env"));
    });
  });

  describe("getRequiredEnv", () => {
    it("should return environment variable value when set", () => {
      process.env["REQUIRED_VAR"] = "test-value";

      const result = getRequiredEnv("REQUIRED_VAR");

      expect(result).toBe("test-value");
    });

    it("should throw error when environment variable is not set", () => {
      delete process.env["MISSING_VAR"];

      expect(() => getRequiredEnv("MISSING_VAR")).toThrow(
        "Required environment variable MISSING_VAR is not set"
      );
    });

    it("should throw error when environment variable is empty string", () => {
      process.env["EMPTY_VAR"] = "";

      expect(() => getRequiredEnv("EMPTY_VAR")).toThrow(
        "Required environment variable EMPTY_VAR is not set"
      );
    });
  });

  describe("getOptionalEnv", () => {
    it("should return environment variable value when set", () => {
      process.env["OPTIONAL_VAR"] = "test-value";

      const result = getOptionalEnv("OPTIONAL_VAR", "default-value");

      expect(result).toBe("test-value");
    });

    it("should return default value when environment variable is not set", () => {
      delete process.env["MISSING_VAR"];

      const result = getOptionalEnv("MISSING_VAR", "default-value");

      expect(result).toBe("default-value");
    });

    it("should return default value when environment variable is empty string", () => {
      process.env["EMPTY_VAR"] = "";

      const result = getOptionalEnv("EMPTY_VAR", "default-value");

      expect(result).toBe("default-value");
    });
  });

  describe("getEnvAsNumber", () => {
    it("should return parsed number when environment variable is valid number", () => {
      process.env["NUMBER_VAR"] = "42";

      const result = getEnvAsNumber("NUMBER_VAR", 0);

      expect(result).toBe(42);
    });

    it("should return default value when environment variable is not set", () => {
      delete process.env["MISSING_NUMBER"];

      const result = getEnvAsNumber("MISSING_NUMBER", 100);

      expect(result).toBe(100);
    });

    it("should return default value and warn when environment variable is not a valid number", () => {
      process.env["INVALID_NUMBER"] = "not-a-number";
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = getEnvAsNumber("INVALID_NUMBER", 50);

      expect(result).toBe(50);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Environment variable INVALID_NUMBER is not a valid number, using default: 50"
      );

      consoleSpy.mockRestore();
    });

    it("should handle negative numbers correctly", () => {
      process.env["NEGATIVE_NUMBER"] = "-123";

      const result = getEnvAsNumber("NEGATIVE_NUMBER", 0);

      expect(result).toBe(-123);
    });

    it("should handle zero correctly", () => {
      process.env["ZERO_NUMBER"] = "0";

      const result = getEnvAsNumber("ZERO_NUMBER", 100);

      expect(result).toBe(0);
    });
  });

  describe("getEnvAsBoolean", () => {
    it('should return true when environment variable is "true"', () => {
      process.env["BOOL_VAR"] = "true";

      const result = getEnvAsBoolean("BOOL_VAR", false);

      expect(result).toBe(true);
    });

    it('should return true when environment variable is "TRUE"', () => {
      process.env["BOOL_VAR"] = "TRUE";

      const result = getEnvAsBoolean("BOOL_VAR", false);

      expect(result).toBe(true);
    });

    it('should return false when environment variable is "false"', () => {
      process.env["BOOL_VAR"] = "false";

      const result = getEnvAsBoolean("BOOL_VAR", true);

      expect(result).toBe(false);
    });

    it("should return false when environment variable is any other value", () => {
      process.env["BOOL_VAR"] = "yes";

      const result = getEnvAsBoolean("BOOL_VAR", true);

      expect(result).toBe(false);
    });

    it("should return default value when environment variable is not set", () => {
      delete process.env["MISSING_BOOL"];

      const result = getEnvAsBoolean("MISSING_BOOL", true);

      expect(result).toBe(true);
    });

    it("should return default value when environment variable is empty string", () => {
      process.env["EMPTY_BOOL"] = "";

      const result = getEnvAsBoolean("EMPTY_BOOL", true);

      expect(result).toBe(true);
    });
  });
});
