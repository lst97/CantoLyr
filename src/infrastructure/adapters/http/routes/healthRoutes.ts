import type { FastifyInstance } from 'fastify';
import type { Container } from '../../../container/Container.js';

/**
 * Setup health check routes
 * Implements requirement 4.1 for health check endpoint
 */
export async function setupHealthRoutes(app: FastifyInstance, _container: Container): Promise<void> {
  // Health check endpoint - already implemented in FastifyServer.ts
  // This function is for consistency with other route modules
  // The actual health endpoint is registered in FastifyServer.setupRoutes()
  
  app.log.info('Health routes configured');
}