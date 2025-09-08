import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Container } from '../../../src/infrastructure/container/Container.js';
import type { AppConfig } from '../../../src/infrastructure/config/AppConfig.js';

describe('Route Handlers Contract Tests', () => {
  let container: Container;
  let testConfig: AppConfig;

  beforeAll(async () => {
    // Create test configuration
    testConfig = {
      env: 'test',
      database: {
        url: process.env["TEST_DATABASE_URL"] || 'postgresql://cantolyr:cantolyr_dev_password@localhost:5432/cantolyr_test',
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
        logLevel: 'info', // Suppress logs during tests
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

  beforeEach(async () => {
    // Clear cache between tests
    await container.cache.clear();
  });

  describe('GET /search/pronunciation', () => {
    it('should search with valid pronunciation pattern', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'GET',
        url: '/search/pronunciation?p=39'
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        query: '39',
        count: expect.any(Number),
        items: expect.any(Array),
        fromCache: false,
        processingTimeMs: expect.any(Number)
      });
      
      // Validate item structure if results exist
      if (body.items.length > 0) {
        const item = body.items[0];
        expect(item).toMatchObject({
          id: expect.any(String),
          surface: expect.any(String),
          jyutping: expect.any(Array),
          tone: expect.any(String),
          pronunciation: expect.any(String),
          consonants: expect.any(Array),
          rhymes: expect.any(Array),
          syllables: expect.any(Number),
          freq: expect.any(Number),
          pos: expect.any(String),
          register: expect.any(String),
          gloss: expect.any(String),
          source: expect.any(String),
          type: expect.stringMatching(/^(vocab|char)$/),
          lang: expect.any(String)
        });
      }
    });

    it('should handle prefix search', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'GET',
        url: '/search/pronunciation?p=3&prefix=true'
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.query).toBe('3');
    });

    it('should filter by mode', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'GET',
        url: '/search/pronunciation?p=39&mode=vocab'
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      // All items should be vocab type if results exist
      if (body.items.length > 0) {
        body.items.forEach((item: any) => {
          expect(item.type).toBe('vocab');
        });
      }
    });

    it('should respect limit parameter', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'GET',
        url: '/search/pronunciation?p=3&limit=5'
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeLessThanOrEqual(5);
    });

    it('should return 400 for invalid pronunciation pattern', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'GET',
        url: '/search/pronunciation?p=invalid'
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error).toHaveProperty('code');
    });

    it('should return 400 for missing pronunciation pattern', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'GET',
        url: '/search/pronunciation'
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error).toHaveProperty('code');
    });

    it('should return 400 for invalid mode', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'GET',
        url: '/search/pronunciation?p=39&mode=invalid'
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error).toHaveProperty('code');
    });

    it('should return 400 for limit exceeding maximum', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'GET',
        url: '/search/pronunciation?p=39&limit=300'
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('Error');
    });

    it('should use cache on repeated requests', async () => {
      const app = container.server.instance;
      
      // First request
      const response1 = await app.inject({
        method: 'GET',
        url: '/search?v=39'
      });
      
      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.fromCache).toBe(false);
      
      // Second request should use cache
      const response2 = await app.inject({
        method: 'GET',
        url: '/search?v=39'
      });
      
      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);
      expect(body2.fromCache).toBe(true);
    });
  });

  describe('POST /compose/line', () => {
    it('should compose line with valid tone pattern', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/compose/line',
        payload: {
          tonePattern: '39 4'
        }
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        line: expect.any(String),
        selections: expect.any(Array),
        usedLlm: expect.any(Boolean),
        processingTimeMs: expect.any(Number),
        totalCandidates: expect.any(Number),
        filteredCandidates: expect.any(Number)
      });
      
      // Validate selections structure
      if (body.selections.length > 0) {
        const selection = body.selections[0];
        expect(selection).toMatchObject({
          group: expect.any(Number),
          option: expect.any(Number),
          surface: expect.any(String),
          readingId: expect.any(String)
        });
      }
    });

    it('should handle optional parameters', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/compose/line',
        payload: {
          tonePattern: '39',
          maxPerGroup: 100,
          theme: 'love',
          mood: 'happy',
          genre: 'pop',
          language: 'zh-HK',
          seed: 12345
        }
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.line).toBeTruthy();
    });

    it('should return 400 for invalid tone pattern', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/compose/line',
        payload: {
          tonePattern: 'invalid'
        }
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request parameters',
        requestId: expect.any(String)
      });
    });

    it('should return 400 for missing tone pattern', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/compose/line',
        payload: {}
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('Error');
    });

    it('should return 400 for invalid maxPerGroup', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/compose/line',
        payload: {
          tonePattern: '39',
          maxPerGroup: 300
        }
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('Error');
    });

    it('should handle empty tone pattern groups', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/compose/line',
        payload: {
          tonePattern: '   '
        }
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /feedback/select', () => {
    it('should record feedback with valid data', async () => {
      const app = container.server.instance;
      
      // First, get a reading ID from pronunciation search
      const searchResponse = await app.inject({
        method: 'GET',
        url: '/search/pronunciation?p=39&limit=1'
      });
      
      expect(searchResponse.statusCode).toBe(200);
      const searchBody = JSON.parse(searchResponse.body);
      
      if (searchBody.items.length === 0) {
        // Skip test if no data available
        return;
      }
      
      const readingId = searchBody.items[0].id;
      
      const response = await app.inject({
        method: 'POST',
        url: '/feedback/select',
        payload: {
          readingId,
          accepted: true
        }
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        success: true,
        processingTimeMs: expect.any(Number),
        sessionId: expect.any(String),
        validation: {
          readingExists: true,
          readingSurface: expect.any(String)
        }
      });
    });

    it('should record feedback with context', async () => {
      const app = container.server.instance;
      
      // First, get a reading ID from search
      const searchResponse = await app.inject({
        method: 'GET',
        url: '/search?v=39&limit=1'
      });
      
      expect(searchResponse.statusCode).toBe(200);
      const searchBody = JSON.parse(searchResponse.body);
      
      if (searchBody.items.length === 0) {
        // Skip test if no data available
        return;
      }
      
      const readingId = searchBody.items[0].id;
      
      const response = await app.inject({
        method: 'POST',
        url: '/feedback/select',
        payload: {
          readingId,
          accepted: false,
          sessionId: 'test_session_123',
          context: {
            tonePattern: '39 4',
            theme: 'love',
            mood: 'sad',
            genre: 'ballad',
            position: 0,
            completeLine: '愛情',
            usedLlm: true
          }
        }
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.sessionId).toBe('test_session_123');
    });

    it('should return 404 for non-existent reading ID', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/feedback/select',
        payload: {
          readingId: '999999999',
          accepted: true
        }
      });

      expect(response.statusCode).toBe(404);
      
      const body = JSON.parse(response.body);
      expect(body.error).toMatchObject({
        code: 'READING_NOT_FOUND',
        message: expect.stringContaining('not found'),
        requestId: expect.any(String)
      });
    });

    it('should return 400 for invalid reading ID format', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/feedback/select',
        payload: {
          readingId: 'invalid',
          accepted: true
        }
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing required fields', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/feedback/select',
        payload: {
          readingId: '123'
          // missing accepted field
        }
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('Error');
    });

    it('should return 400 for invalid session ID format', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/feedback/select',
        payload: {
          readingId: '123',
          accepted: true,
          sessionId: 'invalid session id!'
        }
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('Error');
    });

    it('should return 400 for context data too large', async () => {
      const app = container.server.instance;
      
      // Create a large context object
      const largeContext = {
        tonePattern: 'a'.repeat(10000) // Very large string
      };
      
      const response = await app.inject({
        method: 'POST',
        url: '/feedback/select',
        payload: {
          readingId: '123',
          accepted: true,
          context: largeContext
        }
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONTEXT_TOO_LARGE');
    });

    it('should generate session ID if not provided', async () => {
      const app = container.server.instance;
      
      // First, get a reading ID from search
      const searchResponse = await app.inject({
        method: 'GET',
        url: '/search?v=39&limit=1'
      });
      
      expect(searchResponse.statusCode).toBe(200);
      const searchBody = JSON.parse(searchResponse.body);
      
      if (searchBody.items.length === 0) {
        // Skip test if no data available
        return;
      }
      
      const readingId = searchBody.items[0].id;
      
      const response = await app.inject({
        method: 'POST',
        url: '/feedback/select',
        payload: {
          readingId,
          accepted: true
        }
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.sessionId).toMatch(/^session_/);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'POST',
        url: '/compose/line',
        payload: 'invalid json',
        headers: {
          'content-type': 'application/json'
        }
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.code).toBeTruthy();
    });

    it('should include request ID in all error responses', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'GET',
        url: '/search?v=invalid'
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.requestId).toBeTruthy();
      expect(response.headers['x-request-id']).toBeTruthy();
    });

    it('should handle unsupported HTTP methods', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'PUT',
        url: '/search'
      });

      expect(response.statusCode).toBe(404);
      
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Response Headers', () => {
    it('should include request ID in response headers', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.headers['x-request-id']).toBeTruthy();
    });

    it('should include CORS headers when enabled', async () => {
      const app = container.server.instance;
      
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/search',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'GET'
        }
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBeTruthy();
    });
  });
});
