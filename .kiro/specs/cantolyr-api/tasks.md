# Implementation Plan

- [x] 1. Set up project structure and core configuration

  - Create directory structure following hexagonal architecture
  - Set up package.json with all required dependencies
  - Configure TypeScript with ES2022 modules and strict settings
  - Set up ESLint configuration for code quality
  - Create Docker Compose configuration for PostgreSQL
  - _Requirements: 5.2, 5.3_

- [x] 2. Implement core domain models and value objects

  - Create ToneMap value object with validation logic
  - Implement tone mapping functions (1→3, 2→9, 3→4, 4→0, 5→5, 6→2)
  - Create Entry and Reading domain entities
  - Implement jyutping tone extraction utilities
  - Write unit tests for tone mapping and validation logic
  - _Requirements: 1.6, 7.3_

- [x] 3. Set up database schema and Prisma configuration

  - Create Prisma schema with Entry and Reading models
  - Configure database indexes for optimal query performance
  - Set up Prisma client generation and connection management
  - Create initial database migration
  - _Requirements: 5.3, 5.4_

- [x] 4. Implement data normalization and JSONL parsing

  - Create JSONL parser for streaming large files
  - Implement schema validation for raw entries
  - Build tone extraction and mapping pipeline
  - Create database seeding script with batch insertion
  - Add error handling for malformed entries
  - Write unit tests for data parsing and normalization
  - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.6_

- [x] 5. Create domain ports and repository interfaces

  - Define ReadingRepo interface for CQRS read operations
  - Define WriteRepo interface for feedback operations
  - Create Cache port interface for pluggable caching
  - Define LlmReranker port for AI integration
  - _Requirements: 6.3, 6.4, 6.5_

- [x] 6. Implement database adapters with Prisma

  - Create PrismaReadingRepository with optimized search queries
  - Implement tone-based search with prefix support
  - Add deterministic ordering by type, syllables, and jyutping
  - Create PrismaWriteRepository for feedback recording
  - Write unit tests for repository implementations
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2_

- [x] 7. Implement caching layer

  - Create InMemoryCache adapter with TTL support
  - Implement cache key generation strategy
  - Add cache warming and invalidation logic
  - Write unit tests for caching behavior
  - _Requirements: 6.1, 6.2_

- [x] 8. Create LLM integration with Gemini API for grouped selection

  - Implement GeminiLlmGroupedSelector with HTTP client for creative word selection
  - Create DummyLlmGroupedSelector for testing and fallback
  - Add Ajv schema validation for LLM grouped selection responses
  - Implement MVP prefilter service for heuristic candidate reduction
  - Create grouped selection prompt builder for structured LLM tasks
  - Implement error handling and fallback strategies
  - Write unit tests for LLM adapters and prefilter logic
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6_

- [x] 9. Implement application use cases with MVP prefilter approach

  - Create SearchUseCase with caching integration
  - Implement ComposeLineUseCase with heuristic prefiltering and LLM grouped selection
  - Integrate MVP prefilter for candidate reduction (70% freq + 30% random for 1-digit, uniform random for multi-digit)
  - Implement grouped selection workflow: prefilter → group by tone → LLM creative selection
  - Create RecordFeedbackUseCase for user selections
  - Replace score combination with deterministic grouped selection approach
  - Write unit tests for all use cases including prefilter integration
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.3, 8.5_

- [x] 10. Set up configuration and environment management

  - Create Zod-based configuration validation
  - Implement environment variable parsing
  - Add configuration for database, LLM, and caching
  - Create .env.example with all required variables
  - _Requirements: 5.1, 5.2, 5.5_

- [x] 11. Implement Fastify HTTP server setup

  - Create Fastify application with TypeScript support
  - Set up Pino logger with request ID correlation
  - Configure Swagger/OpenAPI documentation
  - Implement dependency injection container
  - Add graceful shutdown handling
  - _Requirements: 4.1, 4.3, 4.4_

- [x] 12. Create HTTP route handlers with validation

  - Implement GET /health endpoint for health checks
  - Create GET /search endpoint with Zod validation
  - Implement POST /compose/line endpoint
  - Create POST /feedback/select endpoint
  - Add comprehensive error handling and logging
  - Write contract tests for all endpoints
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 3.1, 3.4, 4.1, 4.2, 4.5_

- [ ] 13. Implement comprehensive error handling

  - Create structured error response format
  - Add validation error handling with detailed messages
  - Implement fallback strategies for external service failures
  - Add proper HTTP status codes for different error types
  - Write tests for error scenarios
  - _Requirements: 1.6, 2.6, 3.4, 4.4, 8.3, 8.6_

- [ ] 14. Set up comprehensive test suite

  - Configure Vitest test runner with TypeScript support
  - Create unit tests for domain logic and utilities
  - Implement contract tests using Fastify inject
  - Create end-to-end tests for complete workflows
  - Add test fixtures and database seeding for tests
  - Set up test coverage reporting
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 15. Create sample data and seeding scripts

  - Create sample vocab.jsonl with diverse examples
  - Create sample chars.jsonl with character data
  - Implement database seeding with sample data
  - Add data validation and error reporting
  - Test complete data pipeline from JSONL to database
  - _Requirements: 5.4, 7.5_

- [ ] 16. Integrate all components and test system

  - Wire up dependency injection for all adapters
  - Test complete search workflow with caching
  - Test compose workflow with LLM integration
  - Test feedback recording and data persistence
  - Verify OpenAPI documentation accuracy
  - Run full test suite and ensure all tests pass
  - _Requirements: All requirements integration testing_

- [ ] 17. Add production optimizations and monitoring

  - Implement request/response logging with performance metrics
  - Add database query optimization and connection pooling
  - Configure production-ready error handling
  - Add health check endpoint with dependency status
  - Create Docker production build configuration
  - _Requirements: 4.3, 4.4_

- [ ] 18. Create documentation and deployment guides
  - Write comprehensive README with setup instructions
  - Document API endpoints and usage examples
  - Create deployment guide for Docker and production
  - Add troubleshooting guide for common issues
  - Document data format requirements and examples
  - _Requirements: 4.2, 5.1_
