import { Hono } from "hono";
import { cors } from "hono/cors";
import { load } from "jsr:@std/dotenv";
import { Container } from "./infrastructure/container/Container.ts";
import { registerHttpRoutes } from "./infrastructure/adapters/http/index.ts";
import { requestLogger } from "./infrastructure/adapters/http/middleware/requestLogger.ts";
import { Logger } from "./infrastructure/logging/Logger.ts";
import { getLogger } from "jsr:@std/log";

declare module "hono" {
  interface ContextVariableMap {
    reqId: string;
  }
}

const logger = getLogger();

async function main() {
  // Load environment variables from .env file
  await load({ export: true });

  // Create and initialize the dependency injection container
  const container = await Container.create();

  const app = new Hono();

  // Setup CORS middleware and error handling
  app.use("*", cors());
  app.use("*", requestLogger());
  app.onError((err, c) => {
    const httpLogger = Logger.for("http");
    const reqId = c.get("reqId") as string | undefined;
    httpLogger.error("unhandled_http_error", {
      path: c.req.path,
      method: c.req.method,
      reqId,
      error: err?.message ?? String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.json(
      { error: "Internal Server Error", message: err.message },
      500,
    );
  });

  // --- API Routes ---
  app.get("/", (c) => c.text("CantoLyr API is running!"));

  // Hono HTTP adapters
  registerHttpRoutes(app, container);

  // Health Check Endpoint
  app.get("/health", async (c) => {
    const health = await container.healthCheck();
    const isHealthy = Object.values(health).every(Boolean);
    return c.json(health, isHealthy ? 200 : 503);
  });

  // Feedback Endpoint
  app.post("/feedback", async (c) => {
    const feedbackUseCase = container.resolve("recordFeedbackUseCase");
    const body = await c.req.json();
    const result = await feedbackUseCase.execute(body);
    return c.json(result);
  });

  // 404 handler
  app.notFound((c) => {
    const httpLogger = Logger.for("http");
    const reqId = c.get("reqId") as string | undefined;
    httpLogger.warning("http_404", {
      method: c.req.method,
      path: c.req.path,
      reqId,
    });
    return c.json({ error: "Not Found" }, 404);
  });

  // --- Server Initialization ---
  const port = container.config.server.port;
  container.services.logger.info("server_starting", {
    url: `http://localhost:${port}`,
  });

  const server = Deno.serve({ port }, app.fetch);
  container.services.logger.info("server_running", { port });

  // Graceful shutdown
  const shutdown = async () => {
    container.services.logger.info("server_shutting_down");
    try {
      await server.shutdown();
      await container.dispose();
      container.services.logger.info("shutdown_complete");
      Deno.exit(0);
    } catch (error) {
      container.services.logger.error("shutdown_error", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      Deno.exit(1);
    }
  };

  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  // Global error listeners
  addEventListener("unhandledrejection", (event) => {
    container.services.logger.error("unhandled_promise_rejection", {
      reason: (event as PromiseRejectionEvent).reason?.message ??
        String((event as PromiseRejectionEvent).reason),
    });
  });
  addEventListener("error", (event) => {
    const e = event as ErrorEvent;
    container.services.logger.error("unhandled_error_event", {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack,
    });
  });
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`❌ Unhandled error during startup: ${err?.message ?? String(err)}`);
    Deno.exit(1);
  });
}
