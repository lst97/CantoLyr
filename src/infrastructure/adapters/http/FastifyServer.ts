import Fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import type { AppConfig } from '../../config/AppConfig.js';
import type { Container } from '../../container/Container.js';
import { setupSearchRoutes, setupComposeRoutes, setupFeedbackRoutes, setupHealthRoutes } from './routes/index.js';
import { buildOpenApiDocument } from './openapi.js';

/**
 * Fastify server wrapper with TypeScript support
 * Handles server lifecycle, logging, and graceful shutdown
 */
export class FastifyServer {
  private app: FastifyInstance;
  private container: Container;
  private config: AppConfig;

  constructor(container: Container) {
    this.container = container;
    this.config = container.config;
    this.app = this.createFastifyInstance();
    this.setupMiddleware();
  }

  /**
   * Create Fastify instance with Pino logger and request ID correlation
   */
  private createFastifyInstance(): FastifyInstance {
    return Fastify({
      logger: {
        level: this.config.server.logLevel,
        // Generate unique request ID for correlation
        genReqId: () => randomUUID(),
      },
      // Request timeout configuration
      // Ensure the HTTP server honors API request timeouts from config/env
      requestTimeout: this.config.server.requestTimeout,
      connectionTimeout: this.config.server.requestTimeout,
      keepAliveTimeout: this.config.server.requestTimeout,
      // Trust proxy for proper IP detection
      trustProxy: true,
    });
  }

  /**
   * Setup middleware for CORS, request logging, and error handling
   */
  private setupMiddleware(): void {
    // Add request ID to all responses
    this.app.addHook('onRequest', async (request, reply) => {
      reply.header('X-Request-ID', request.id);
    });

    // Log all requests with timing
    this.app.addHook('onResponse', async (request, reply) => {
      const responseTime = reply.elapsedTime;
      request.log.info(
        {
          responseTime,
          statusCode: reply.statusCode,
          method: request.method,
          url: request.url,
        },
        'Request completed'
      );
    });

    // Global error handler
    this.app.setErrorHandler(async (error, request, reply) => {
      request.log.error(
        {
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name,
          },
          requestId: request.id,
        },
        'Request error'
      );

      // Determine appropriate status code
      let statusCode = 500;
      if (error.statusCode) {
        statusCode = error.statusCode;
      } else if (error.validation) {
        statusCode = 400;
      }

      return reply.status(statusCode).send({
        error: {
          code: error.name || 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred',
          requestId: request.id,
          ...(this.config.env === 'development' && { stack: error.stack }),
        },
      });
    });

    // 404 handler
    this.app.setNotFoundHandler(async (request, reply) => {
      request.log.warn(
        {
          method: request.method,
          url: request.url,
        },
        'Route not found'
      );

      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Route ${request.method} ${request.url} not found`,
          requestId: request.id,
        },
      });
    });

    // CORS support if enabled
    if (this.config.server.corsEnabled) {
      this.app.register(async (fastify) => {
        await fastify.register(import('@fastify/cors'), {
          origin: true, // Allow all origins for MVP
          credentials: true,
          methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
        });
      });
    }
  }

  /**
   * Setup API documentation (ReDoc + static OpenAPI JSON)
   */
  private async setupDocs(): Promise<void> {
    if (!this.config.server.enableSwagger) {
      return;
    }

    // Build static OpenAPI spec and expose as JSON
    const spec = buildOpenApiDocument(this.config);
    this.app.get('/openapi.json', async (_request, reply) => {
      return reply.type('application/json').send(spec);
    });

    // Register ReDoc UI at /docs, rendering the JSON spec from /openapi/json
    this.app.get('/docs', async (_request, reply) => {
      const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CantoLyr API Docs</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', Arial, sans-serif; }
      #redoc-container { height: 100vh; }
    </style>
  </head>
  <body>
    <div id="redoc-container"></div>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
    <script>
      Redoc.init('/openapi.json', { hideDownloadButton: true, expandResponses: '200,201,4XX,5XX' }, document.getElementById('redoc-container'));
    </script>
  </body>
  </html>`;
      return reply.type('text/html').send(html);
    });
  }

  /**
   * Setup all routes using route modules
   */
  private async setupRoutes(): Promise<void> {
    // Health check endpoint
    this.app.get('/health', {
      schema: {
        tags: ['health'],
        summary: 'Health check endpoint',
        description: 'Returns the health status of the API and its dependencies',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['healthy', 'unhealthy'] },
              timestamp: { type: 'string', format: 'date-time' },
              version: { type: 'string' },
              services: {
                type: 'object',
                properties: {
                  database: { type: 'boolean' },
                  cache: { type: 'boolean' },
                  llm: { type: 'boolean' },
                },
                required: ['database', 'cache', 'llm'],
              },
              requestId: { type: 'string' },
            },
            required: ['status', 'timestamp', 'version', 'services', 'requestId'],
          },
          503: {
            type: 'object',
            properties: {
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  requestId: { type: 'string' },
                  details: { type: 'object' },
                },
                required: ['code', 'message', 'requestId'],
              },
            },
            required: ['error'],
          },
        },
      },
    }, async (request, reply) => {
      const health = await this.container.healthCheck();
      const status = health.overall ? 'healthy' : 'unhealthy';
      const statusCode = health.overall ? 200 : 503;

      return reply.status(statusCode).send({
        status,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        services: {
          database: health.database,
          cache: health.cache,
          llm: health.llm,
        },
        requestId: request.id,
      });
    });

    // Root endpoint
    this.app.get('/', {
      schema: {
        tags: ['health'],
        summary: 'API root endpoint',
        description: 'Returns basic API information',
        response: {
          200: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              version: { type: 'string' },
              description: { type: 'string' },
              documentation: { type: 'string' },
              requestId: { type: 'string' },
            },
            required: ['name', 'version', 'description', 'documentation', 'requestId'],
          },
        },
      },
    }, async (request, reply) => {
      return reply.send({
        name: 'CantoLyr API',
        version: '1.0.0',
        description: 'Cantonese lyrics composition assistant API',
        documentation: '/docs',
        requestId: request.id,
      });
    });

    // Setup additional route modules
    await setupHealthRoutes(this.app, this.container);
    await setupSearchRoutes(this.app, this.container);
    await setupComposeRoutes(this.app, this.container);
    await setupFeedbackRoutes(this.app, this.container);
  }

  /**
   * Get the Fastify instance for route registration
   */
  public get instance(): FastifyInstance {
    return this.app;
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      // Setup routes first
      await this.setupRoutes();
      
      // Setup API docs (ReDoc)
      await this.setupDocs();

      // Start listening
      const address = await this.app.listen({
        port: this.config.server.port,
        host: this.config.server.host,
      });

      this.app.log.info(
        {
          address,
          port: this.config.server.port,
          host: this.config.server.host,
          env: this.config.env,
        },
        'Server started successfully'
      );

      // Log available routes
      this.app.log.info('Available routes:');
      this.app.log.info(`  GET  /         - API information`);
      this.app.log.info(`  GET  /health   - Health check`);
      this.app.log.info(`  GET  /search/pronunciation   - Search by pronunciation pattern`);
      this.app.log.info(`  GET  /search/rhyme           - Search by rhyme token`);
      this.app.log.info(`  POST /compose/line - Compose lyrical line`);
      this.app.log.info(`  POST /feedback/select - Record user feedback`);
      if (this.config.server.enableSwagger) {
        this.app.log.info(`  GET  /docs     - API documentation (ReDoc)`);
      }

    } catch (error) {
      this.app.log.error(error, 'Failed to start server');
      throw error;
    }
  }

  /**
   * Stop the server gracefully
   */
  public async stop(): Promise<void> {
    try {
      this.app.log.info('Shutting down server...');
      await this.app.close();
      this.app.log.info('Server shutdown complete');
    } catch (error) {
      this.app.log.error(error, 'Error during server shutdown');
      throw error;
    }
  }

  /**
   * Get server address information
   */
  public address(): string | null {
    return this.app.server.address() as string | null;
  }
}
