# Design Document

## Overview

The CantoLyr API is a production-lean Node.js 22 + TypeScript system implementing hexagonal architecture with DDD-lite and CQRS-lite patterns. The system provides ultra-fast Cantonese character/word retrieval based on mapped tone patterns, with optional LLM-enhanced ranking using Google Gemini API.

The architecture separates concerns through ports and adapters, enabling easy testing and future extensibility. The system uses Fastify for high-performance HTTP handling, Prisma for type-safe database access, and implements comprehensive caching and observability features.

## Architecture

### Hexagonal Architecture Implementation

The system follows hexagonal (ports and adapters) architecture with clear separation between:

- **Domain Layer**: Core business logic, entities, value objects, and domain services
- **Application Layer**: Use cases orchestrating domain operations
- **Infrastructure Layer**: External concerns (database, HTTP, caching, LLM)
- **Adapters Layer**: Implementations of infrastructure ports

### CQRS-lite Separation

- **Read Side**: `ReadingRepo` for search operations with caching optimization
- **Write Side**: `WriteRepo` for feedback recording and session management
- **Shared**: Domain models and value objects used by both sides

### Technology Stack

- **Runtime**: Node.js 22+ with TypeScript ES2022 modules
- **Web Framework**: Fastify with Swagger/OpenAPI documentation
- **Database**: PostgreSQL with Prisma ORM
- **Caching**: In-memory cache (MVP) with Redis-ready port interface
- **LLM**: Google Gemini API with fallback to heuristic ranking
- **Validation**: Zod for request DTOs, Ajv for LLM response schemas
- **Testing**: Vitest with Fastify inject for fast HTTP testing
- **Observability**: Pino logger with request ID correlation

## Components and Interfaces

### Domain Layer

#### Core Entities
```typescript
// Entry: Represents a Cantonese character or vocabulary word
interface Entry {
  id: bigint
  surface: string         // The actual text (e.g., "債權人", "亡")
  type: EntryType        // 'vocab' | 'char'
  lang: string           // Language code (zh-HK, misc, etc.)
  readings: Reading[]
}

// Reading: Pronunciation and tone information for an entry
interface Reading {
  id: bigint
  jyutping: string       // e.g., "zaai3 kyun4 jan4"
  toneOriginal: string   // e.g., "341" extracted from jyutping
  toneMapped: string     // e.g., "403" using tone mapping
  syllables: number      // Number of syllables (3 for "zaai3 kyun4 jan4")
  freq: number           // Frequency score
  pos: string            // Part of speech (NOUN, ADJ, NUM, etc.)
  register: string       // Register (formal, neutral, colloquial)
  gloss: string          // English definition
  source: string         // Data source identifier
}
```

#### Value Objects
```typescript
// ToneMap: Validates and encapsulates mapped tone patterns
class ToneMap {
  constructor(value: string) // validates against /^[039452]+$/
}

// Tone mapping: 1→3, 2→9, 3→4, 4→0, 5→5, 6→2
```

#### Domain Services
```typescript
// RankCombiner: Combines heuristic and LLM scores
combineScores(heuristic: number, llm?: number): number
// Formula: (llm ?? 0) * 0.7 + heuristic * 0.3
```

### Application Layer

#### Use Cases
1. **SearchUseCase**: Handles tone-based search with caching
2. **ComposeLineUseCase**: Orchestrates candidate retrieval and LLM ranking
3. **RecordFeedbackUseCase**: Records user selections for learning

### Infrastructure Ports

#### Repository Interfaces
```typescript
interface ReadingRepo {
  searchByToneMapped(query: SearchQuery): Promise<ReadingDTO[]>
  getByIds(ids: bigint[]): Promise<ReadingDTO[]>
}

interface WriteRepo {
  recordSelection(input: SelectionInput): Promise<void>
}
```

#### External Service Interfaces
```typescript
interface Cache {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlSec: number): Promise<void>
}

interface LlmReranker {
  rerank(input: RerankInput): Promise<RerankResult>
}
```

### Adapter Implementations

#### Database Adapters
- **PrismaReadingRepository**: Implements ReadingRepo with optimized queries
- **PrismaWriteRepository**: Implements WriteRepo for feedback storage

#### Cache Adapters
- **InMemoryCache**: MVP implementation with TTL support
- **RedisCache**: Future implementation for production scaling

#### LLM Adapters
- **GeminiLlmReranker**: Google Gemini API integration with error handling
- **DummyLlmReranker**: Deterministic fallback for testing/development

#### HTTP Adapters
- **Fastify Routes**: RESTful endpoints with Zod validation
- **OpenAPI Integration**: Swagger UI for API documentation

## Data Models

### Database Schema (Prisma)

```prisma
enum EntryType {
  vocab
  char
}

model Entry {
  id        BigInt      @id @default(autoincrement())
  surface   String      // The actual character/word text
  type      EntryType
  lang      String      // Language code (zh-HK, misc, etc.)
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt
  readings  Reading[]

  @@index([type, surface])
  @@index([lang, type])
}

model Reading {
  id           BigInt   @id @default(autoincrement())
  entryId      BigInt
  entry        Entry    @relation(fields: [entryId], references: [id], onDelete: Cascade)
  jyutping     String
  toneOriginal String   // Extracted from jyutping (e.g., "341" from "zaai3 kyun4 jan4")
  toneMapped   String   // Mapped using tone conversion (e.g., "403")
  syllables    Int      // Number of syllables
  freq         Float    // Frequency score
  pos          String   // Part of speech (NOUN, ADJ, NUM, LETTER, etc.)
  register     String   // Register (formal, neutral, colloquial)
  gloss        String   // English gloss/definition
  source       String   // Data source (lexicon_v1, charfreq_v1, etc.)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([toneMapped])
  @@index([toneMapped, syllables])
  @@index([syllables])
  @@index([freq])
}
```

### Data Normalization Pipeline

#### JSONL Data Format
The system expects JSONL (JSON Lines) format with the following structure:

**vocab.jsonl** - Vocabulary entries:
```json
{
  "surface": "債權人",
  "type": "vocab",
  "lang": "zh-HK",
  "readings": [{
    "jyutping": "zaai3 kyun4 jan4",
    "freq": 0.8,
    "pos": "NOUN",
    "register": "formal",
    "gloss": "creditor",
    "source": "lexicon_v1"
  }]
}
```

**chars.jsonl** - Character entries:
```json
{
  "surface": "亡",
  "type": "char",
  "lang": "zh-HK",
  "readings": [{
    "jyutping": "mong4",
    "freq": 39,
    "pos": "NOUN",
    "register": "neutral",
    "gloss": "death; to perish",
    "source": "charfreq_v1"
  }]
}
```

#### Parser Architecture
```typescript
interface JsonlParser {
  parseFile(filePath: string): AsyncGenerator<RawEntry>
  validateEntry(entry: unknown): RawEntry
  normalizeEntry(entry: RawEntry): NormalizedEntry
}

interface RawEntry {
  surface: string
  type: 'vocab' | 'char'
  lang: string
  readings: RawReading[]
}

interface RawReading {
  jyutping: string
  freq: number
  pos: string
  register: string
  gloss: string
  source: string
}
```

#### Normalization Flow
1. **JSONL Parsing**: Stream-process large files line by line
2. **Schema Validation**: Validate each entry against expected structure
3. **Tone Extraction**: Parse jyutping to extract tone digits
4. **Tone Mapping**: Convert original tones using mapping rules (1→3, 2→9, etc.)
5. **Syllable Counting**: Count syllables from tone pattern length
6. **Database Insertion**: Batch insert with transaction support
7. **Error Handling**: Log malformed entries and continue processing

### API Data Transfer Objects

#### Request DTOs (Zod Schemas)
```typescript
const SearchQuerySchema = z.object({
  v: z.string().refine(isValidMapped),
  mode: z.enum(['all', 'vocab', 'char']).optional(),
  prefix: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
})

const ComposeRequestSchema = z.object({
  toneMap: z.string().refine(isValidMapped),
  topK: z.number().int().min(1).max(200).optional(),
  constraints: z.any().optional(),
  context: z.any().optional()
})
```

#### Response DTOs
```typescript
interface SearchResponse {
  query: string
  count: number
  items: ReadingDTO[]
}

interface ComposeResponse {
  ranking: RankedItem[]
}

interface RankedItem {
  id: bigint
  score: number
  reason?: string
}
```

## Error Handling

### Error Classification
1. **Validation Errors**: Invalid input parameters (400)
2. **Not Found Errors**: Missing resources (404)
3. **External Service Errors**: LLM API failures (503 with fallback)
4. **Database Errors**: Connection/query failures (500)
5. **Rate Limiting**: API quota exceeded (429)

### Error Response Format
```typescript
interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: any
    requestId: string
  }
}
```

### Fallback Strategies
- **LLM Failure**: Graceful degradation to heuristic ranking
- **Cache Miss**: Direct database query with cache warming
- **Database Timeout**: Return cached results if available

## Testing Strategy

### Test Pyramid Structure

#### Unit Tests (Vitest)
- **Domain Logic**: Tone mapping, validation, score combination
- **Data Parsers**: Format conversion and normalization
- **Utilities**: Helper functions and value objects
- **Coverage Target**: 90%+ for domain and utility code

#### Contract Tests (Vitest + Fastify Inject)
- **API Endpoints**: Request/response validation
- **Schema Compliance**: OpenAPI specification adherence
- **Error Scenarios**: Validation and error handling
- **Performance**: Response time benchmarks

#### End-to-End Tests (Vitest + Test Database)
- **Complete Workflows**: Search → Compose → Feedback cycles
- **LLM Integration**: Gemini API interaction (with mocks)
- **Data Pipeline**: JSONL import and processing
- **Caching Behavior**: Cache hit/miss scenarios

### Test Data Management
- **Fixtures**: Sample JSONL files for consistent testing
- **Database Seeding**: Automated test data setup
- **Mock Services**: LLM and external service mocking
- **Isolation**: Each test runs with clean state

### Performance Testing
- **Load Testing**: Concurrent search requests
- **Cache Performance**: Hit ratio and response times
- **Database Optimization**: Query performance profiling
- **Memory Usage**: Leak detection and optimization

## Deployment and Configuration

### Environment Configuration (Zod Validation)
```typescript
const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.string().default('3000'),
  LLM_ENABLED: z.string().default('false'),
  GEMINI_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CACHE_TTL: z.string().default('60')
})
```

### Docker Configuration
- **Multi-stage Build**: Optimized production image
- **PostgreSQL Service**: Local development database
- **Health Checks**: Container readiness probes
- **Security**: Non-root user, minimal attack surface

### Observability

#### Logging Strategy (Pino)
- **Request Correlation**: Unique request IDs
- **Structured Logging**: JSON format for parsing
- **Performance Metrics**: Response times and cache hits
- **Error Tracking**: Stack traces and context

#### Monitoring Points
- **API Endpoints**: Response times and error rates
- **Database**: Query performance and connection pool
- **Cache**: Hit ratios and memory usage
- **LLM Service**: API call success/failure rates

### Future Scalability Considerations

#### Horizontal Scaling
- **Stateless Design**: No server-side session storage
- **Database Connection Pooling**: Prisma connection management
- **Cache Distribution**: Redis cluster for shared caching
- **Load Balancing**: Multiple API instances

#### Performance Optimizations
- **Database Indexing**: Optimized for tone pattern queries
- **Query Optimization**: Efficient JOIN strategies
- **Caching Layers**: Multi-level caching (memory + Redis)
- **CDN Integration**: Static asset delivery

#### Extensibility Points
- **Plugin Architecture**: Additional data parsers
- **LLM Providers**: Multiple AI service integrations
- **Export Formats**: Additional output formats
- **Authentication**: Future user management system