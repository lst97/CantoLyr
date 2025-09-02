# Requirements Document

## Introduction

The CantoLyr API is a minimal MVP system designed to help lyricists compose Cantonese lyrics by providing ultra-fast character/word retrieval based on mapped tone patterns. The system uses a hexagonal architecture with DDD-lite principles and CQRS-lite separation to deliver three core functions: tone-based search, LLM-enhanced composition assistance, and user feedback collection for future learning.

## Requirements

### Requirement 1

**User Story:** As a lyricist, I want to search for Cantonese characters and words by their mapped tone patterns, so that I can quickly find candidates that match my lyrical composition needs.

#### Acceptance Criteria

1. WHEN I send a GET request to `/search` with a valid mapped tone string (v parameter) THEN the system SHALL return matching characters/words with their tone mappings
2. WHEN I specify a mode parameter (all/vocab/char) THEN the system SHALL filter results by entry type accordingly
3. WHEN I set prefix=true THEN the system SHALL return entries where the tone pattern starts with my query string
4. WHEN I specify a limit parameter THEN the system SHALL return no more than the specified number of results (max 200)
5. WHEN results are returned THEN the system SHALL order them deterministically by entry type, syllables, tone mapping, and jyutping
6. WHEN I query with an invalid tone pattern THEN the system SHALL return a validation error

### Requirement 2

**User Story:** As a lyricist, I want to compose lyrical lines with LLM-enhanced ranking, so that I can get contextually relevant suggestions that consider both tone matching and semantic appropriateness.

#### Acceptance Criteria

1. WHEN I send a POST request to `/compose/line` with a tone map THEN the system SHALL retrieve matching candidates and return a ranked list
2. WHEN LLM_ENABLED is false THEN the system SHALL return heuristic-based ranking scores
3. WHEN LLM_ENABLED is true THEN the system SHALL combine heuristic scores (30%) with LLM reranking scores (70%)
4. WHEN I provide optional constraints or context THEN the system SHALL pass these to the LLM reranker for consideration
5. WHEN I specify topK parameter THEN the system SHALL limit initial candidate retrieval to that number
6. WHEN the LLM reranker fails THEN the system SHALL fallback to heuristic-only ranking

### Requirement 3

**User Story:** As a lyricist, I want to provide feedback on character/word selections, so that the system can learn from my preferences and improve future recommendations.

#### Acceptance Criteria

1. WHEN I send a POST request to `/feedback/select` with a reading ID and acceptance status THEN the system SHALL record my selection
2. WHEN I provide a session ID THEN the system SHALL associate the feedback with that session
3. WHEN feedback is successfully recorded THEN the system SHALL return a confirmation response
4. WHEN I provide an invalid reading ID THEN the system SHALL return an appropriate error

### Requirement 4

**User Story:** As a developer, I want the system to have proper observability and documentation, so that I can monitor performance and integrate with the API effectively.

#### Acceptance Criteria

1. WHEN the system starts THEN it SHALL expose a health check endpoint at `/health`
2. WHEN I access `/docs` THEN the system SHALL serve interactive API documentation via Redoc UI
3. WHEN any request is processed THEN the system SHALL log it with a unique request ID using Pino logger
4. WHEN errors occur THEN the system SHALL log them with appropriate context and return structured error responses
5. WHEN the system processes requests THEN it SHALL validate input using Zod schemas

### Requirement 5

**User Story:** As a system administrator, I want the application to be containerized and configurable, so that I can deploy it consistently across different environments.

#### Acceptance Criteria

1. WHEN I run `docker compose up db` THEN PostgreSQL SHALL start and be accessible for the application
2. WHEN I set environment variables THEN the system SHALL validate and use them via a Zod-based configuration module
3. WHEN I run database migrations THEN the system SHALL create the required schema using Prisma
4. WHEN I run the seed script THEN the system SHALL populate the database with sample data from JSONL files
5. WHEN the application starts THEN it SHALL connect to PostgreSQL using the configured DATABASE_URL

### Requirement 6

**User Story:** As a developer, I want the system to use caching and proper data access patterns, so that search performance is optimized and the architecture is maintainable.

#### Acceptance Criteria

1. WHEN search queries are made THEN the system SHALL cache results using an in-memory cache (MVP) behind a Cache port
2. WHEN the same search is repeated within the TTL THEN the system SHALL return cached results
3. WHEN reading data THEN the system SHALL use a dedicated ReadingRepo following CQRS-lite principles
4. WHEN writing feedback data THEN the system SHALL use a separate WriteRepo
5. WHEN the cache implementation needs to change THEN it SHALL be swappable via the Cache port interface

### Requirement 7

**User Story:** As a data administrator, I want to import Cantonese vocabulary data from various sources, so that the system can be populated with comprehensive character and word datasets.

#### Acceptance Criteria

1. WHEN I provide data in JSON format THEN the system SHALL parse and normalize it to the target schema
2. WHEN I provide data in TXT format THEN the system SHALL use a dedicated parser to convert it to the target JSON format
3. WHEN data is normalized THEN it SHALL be validated against the expected schema before database insertion
4. WHEN parsing fails for any record THEN the system SHALL log the error and continue processing remaining records
5. WHEN the seed script runs THEN it SHALL process all supported data formats and insert them into the database
6. WHEN data sources have different structures THEN the parser SHALL handle format variations and map them to consistent output

### Requirement 8

**User Story:** As a lyricist, I want LLM-powered refinement using Gemini, so that I can get intelligent word picking and contextual suggestions for my Cantonese lyrics.

#### Acceptance Criteria

1. WHEN LLM reranking is enabled THEN the system SHALL use Google Gemini API for word refinement
2. WHEN I provide context or constraints THEN Gemini SHALL consider them for intelligent word picking
3. WHEN Gemini API is unavailable THEN the system SHALL fallback to heuristic ranking gracefully
4. WHEN using Gemini THEN the system SHALL validate API responses against expected JSON schema using Ajv
5. WHEN Gemini returns rankings THEN the system SHALL combine them with heuristic scores using the defined weighting (70% LLM, 30% heuristic)
6. WHEN API rate limits are hit THEN the system SHALL handle errors appropriately and use fallback ranking

### Requirement 9

**User Story:** As a developer, I want comprehensive test coverage, so that I can ensure system reliability and facilitate safe refactoring.

#### Acceptance Criteria

1. WHEN I run unit tests THEN they SHALL cover tone mapping logic, validation functions, and data parsers
2. WHEN I run contract tests THEN they SHALL verify API endpoint behavior and response schemas
3. WHEN I run end-to-end tests THEN they SHALL test complete user workflows including compose functionality
4. WHEN tests are executed THEN they SHALL use Vitest as the test runner
5. WHEN testing HTTP endpoints THEN the system SHALL use Fastify's inject method for fast testing
