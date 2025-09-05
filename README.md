# CantoLyr API

A minimal MVP system designed to help lyricists compose Cantonese lyrics by providing ultra-fast character/word retrieval based on mapped tone patterns.

## Features

- Tone-based search for Cantonese characters and words
- LLM-enhanced composition assistance with Google Gemini
- User feedback collection for learning
- Hexagonal architecture with DDD-lite principles
- CQRS-lite separation for read/write operations

## Quick Start

### Prerequisites

- Node.js 22+
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

   This will create both the main database (`cantolyr`) and test database (`cantolyr_test`) in PostgreSQL.

4. Install dependencies:

   ```bash
   pnpm install
   ```

5. Generate Prisma client and run migrations:

   ```bash
   pnpm run db:generate
   pnpm run db:migrate
   ```

6. Seed the database with sample data:

   ```bash
   pnpm exec tsx scripts/seed-sample-data.ts
   ```

   This will populate the database with:

   - 5,797 character entries from `data/sample/charlist.json`
   - 61,627 vocabulary entries from `data/sample/wordslist.json`
   - Normalized tone mappings and jyutping data

   The seeding process may take a few minutes to complete.

7. Start the development server:

   ```bash
   pnpm run dev
   ```

The API will be available at `http://localhost:3000` with interactive documentation at `http://localhost:3000/docs`.

## Development

### Scripts

- `pnpm run dev` - Start development server with hot reload
- `pnpm run build` - Build for production
- `pnpm run start` - Start production server
- `pnpm test` - Run tests
- `pnpm run test:watch` - Run tests in watch mode
- `pnpm run test:coverage` - Run tests with coverage
- `pnpm run lint` - Lint code
- `pnpm run lint:fix` - Fix linting issues

### Database

- `pnpm run db:generate` - Generate Prisma client
- `pnpm run db:migrate` - Run database migrations
- `pnpm exec tsx scripts/seed-sample-data.ts` - Seed database with sample data
- `pnpm run db:reset` - Reset database (destructive)

#### Database Initialization

The project includes sample data from two sources:

- **Character frequency data** (`data/sample/charlist.json`): 5,797 individual characters with tone mappings
- **Vocabulary data** (`data/sample/wordslist.json`): 61,627 words and phrases with jyutping pronunciations

To initialize the database with this data:

1. Ensure the database is running and migrations are applied
2. Run the seeding script: `pnpm exec tsx scripts/seed-sample-data.ts`
3. The script will:
   - Load and normalize the sample data
   - Clean up any existing sample data
   - Insert all entries with their readings and tone mappings
   - Provide progress updates during insertion

#### Testing with Sample Data

For integration testing with a separate test database:

1. Set up a test database (e.g., `cantolyr_test`)
2. Set the `TEST_DATABASE_URL` environment variable
3. Run integration tests: `TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/cantolyr_test" pnpm test`

The integration tests will automatically load and use the sample data for realistic testing scenarios.

## Architecture

The project follows hexagonal architecture with:

- **Domain Layer**: Core business logic and entities
- **Application Layer**: Use cases and orchestration
- **Infrastructure Layer**: External concerns (database, HTTP, caching)
- **Adapters Layer**: Implementations of infrastructure ports

## API Endpoints

- `GET /health` - Health check
- `GET /search` - Search characters/words by tone pattern
- `POST /compose/line` - Compose lyrical lines with LLM ranking
- `POST /feedback/select` - Record user feedback
- `GET /docs` - API documentation

## License

MIT
