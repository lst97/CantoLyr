# CantoLyr API

A minimal MVP system designed to help lyricists compose Cantonese lyrics by providing ultra-fast
character/word retrieval based on mapped tone patterns.

## Features

- Tone-based search for Cantonese characters and words
- LLM-enhanced composition assistance with Google Gemini
- User feedback collection for learning
- Hexagonal architecture with DDD-lite principles
- CQRS-lite separation for read/write operations

## Quick Start

### Prerequisites

- Deno v1.40+
- Docker and Docker Compose
- PostgreSQL (via Docker)

### Setup

1. Clone the repository
2. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

3. Start the database:

   ```bash
   docker compose up db -d
   ```

4. Generate Prisma client and run migrations (Deno-native):

   ```bash
   deno run -A npm:prisma@latest generate
   deno run -A npm:prisma@latest migrate dev
   ```

5. Seed the database with sample data:

   ```bash
   deno task db:populate
   ```

   This will populate the database with sample character and vocabulary entries.

6. Start the development server:

   ```bash
   deno task dev
   ```

The API will be available at `http://localhost:3000`.

Note on Prisma + Deno

- We generate a Deno-native Prisma Client using `provider = "prisma-client"` and `runtime = "deno"`
  into `prisma/generated/`.
- Import it directly via `import { PrismaClient } from "./prisma/generated/client.ts"`.
- Always run `deno run -A npm:prisma@latest generate` after schema changes to refresh the client.
- For production/edge environments, you may switch DATABASE_URL to a `prisma://` Accelerate URL if
  desired, but it is not required for local Postgres.

## Development

### Scripts

- `deno task dev` - Start development server with hot reload
- `deno task start` - Start production server
- `deno task lint` - Lint code
- `deno task fmt` - Format code

### Database

- `pnpm exec prisma generate` - Generate Prisma client
- `pnpm exec prisma migrate dev` - Run database migrations
- `deno task db:populate` - Seed database with sample data
- `deno task db:reset-seed` - Reset and re-seed the database

### Vector Database (Chroma)

- `deno task vector:ingest` - Ingest data into ChromaDB via the Python script.

## Architecture

The project follows hexagonal architecture with:

- **Domain Layer**: Core business logic and entities
- **Application Layer**: Use cases and orchestration
- **Infrastructure Layer**: External concerns (database, HTTP, caching)

## API Endpoints

- `GET /` - Welcome message
- `GET /health` - Health check
- `POST /search` - Search characters/words by tone pattern
- `POST /compose` - Compose lyrical lines with LLM ranking
- `POST /feedback` - Record user feedback

## License

MIT
