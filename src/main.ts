#!/usr/bin/env node

import { loadEnvFile } from './infrastructure/config/env.js';
import { Container } from './infrastructure/container/Container.js';

/**
 * Main application entry point
 * Demonstrates the MVP configuration system
 */
async function main(): Promise<void> {
  try {
    // Load environment variables from .env file if it exists
    loadEnvFile();

    // Initialize the dependency injection container
    const container = Container.getInstance();
    
    console.log('🚀 CantoLyr API Starting...');
    console.log(`📝 Environment: ${container.config.env}`);
    console.log(`🗄️  Database: ${container.config.database.url}`);
    console.log(`🤖 LLM Provider: ${container.config.llm.provider}`);
    console.log(`💾 Cache Type: ${container.config.cache.type}`);
    console.log(`🌐 Server: ${container.config.server.host}:${container.config.server.port}`);

    // Initialize database connection
    await container.initialize();

    // Perform health check
    const health = await container.healthCheck();
    console.log('🏥 Health Check Results:');
    console.log(`  Database: ${health.database ? '✅' : '❌'}`);
    console.log(`  Cache: ${health.cache ? '✅' : '❌'}`);
    console.log(`  LLM: ${health.llm ? '✅' : '❌'}`);
    console.log(`  Overall: ${health.overall ? '✅' : '❌'}`);

    if (!health.overall) {
      console.warn('⚠️  Some services are not healthy. Check the logs above.');
    }

    // Demonstrate use case access
    console.log('\n🔧 Available Use Cases:');
    console.log('  - Search Use Case: Ready');
    console.log('  - Compose Line Use Case: Ready');
    console.log('  - Record Feedback Use Case: Ready');

    console.log('\n✅ CantoLyr API initialized successfully!');
    
    // Start the HTTP server
    console.log('🌐 Starting HTTP server...');
    await container.server.start();
    
    console.log('🚀 CantoLyr API is now running!');
    console.log(`📖 API Documentation: http://${container.config.server.host}:${container.config.server.port}/docs`);
    console.log(`🏥 Health Check: http://${container.config.server.host}:${container.config.server.port}/health`);

  } catch (error) {
    console.error('❌ Failed to initialize CantoLyr API:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  try {
    const container = Container.getInstance();
    await container.dispose();
    console.log('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  try {
    const container = Container.getInstance();
    await container.dispose();
    console.log('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

// Run the application
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}