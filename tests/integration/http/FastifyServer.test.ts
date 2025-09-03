import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Container } from '../../../src/infrastructure/container/Container.js';
import type { AppConfig } from '../../../src/infrastructure/config/AppConfig.js';

describe('FastifyServer Integration', () => {
  let container: Container;
  let testConfig: AppConfig;

  beforeAll(async () => {
    // Create test configuration
    testConfig = {
      env: 'test',
      database: {
        url: process.env['TEST_DATABASE_URL'] || 'postgresql://cantolyr:cantolyr_dev_password@localhost:5432/cantolyr_test',
        maxConnections: 5,
        connectionTimeout: 10000,
        queryTimeout: 5000,
        logQueries: false
      },
      llm: {
        provider: 'dummy', // Use dummy for tests
        apiKey: undefined,
        model: 'test-model',
        timeoutMs: 5000,
        maxRetries: 1,
        enableFallback: false
      },
      cache: {
        type: 'memory',
        defaultTtl: 60,
        maxSize: 100,
        enableStats: false,
        redisUrl: undefined,
        redisKeyPrefix: 'test:'
      },
      server: {
        port: 0, // Use random available port
        host: '127.0.0.1',
        logLevel: 'silent', // Suppress logs during tests
        enableSwagger: false, // Disable Swagger for faster tests
        corsEnabled: true,
        requestTimeout: 5000
      }
    };

    container = Container.getInstance(testConfig);
    await container.initialize();
    await container.server.start();
  });

  afterAll(async () => {
    await container.dispose();
    Container.reset();
  });

  it('should start server successfully', () => {
    const address = container.server.address();
    expect(address).toBeTruthy();
  });

  it('should respond to health check', async () => {
    const app = container.server.instance;
    
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      status: 'healthy',
      version: '1.0.0',
      services: {
        database: true,
        cache: true,
        llm: true
      }
    });
    expect(body.timestamp).toBeTruthy();
    expect(body.requestId).toBeTruthy();
  });

  it('should respond to root endpoint', async () => {
    const app = container.server.instance;
    
    const response = await app.inject({
      method: 'GET',
      url: '/'
    });

    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      name: 'CantoLyr API',
      version: '1.0.0',
      description: 'Cantonese lyrics composition assistant API',
      documentation: '/docs'
    });
    expect(body.requestId).toBeTruthy();
  });

  it('should handle 404 errors', async () => {
    const app = container.server.instance;
    
    const response = await app.inject({
      method: 'GET',
      url: '/nonexistent'
    });

    expect(response.statusCode).toBe(404);
    
    const body = JSON.parse(response.body);
    expect(body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Route GET /nonexistent not found'
    });
    expect(body.error.requestId).toBeTruthy();
  });

  it('should include request ID in response headers', async () => {
    const app = container.server.instance;
    
    const response = await app.inject({
      method: 'GET',
      url: '/'
    });

    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('should handle CORS if enabled', async () => {
    const app = container.server.instance;
    
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET'
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBeTruthy();
  });
});