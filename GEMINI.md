# Gemini Project Context: CantoLyr API

## Project Overview

This project is a TypeScript-based API for "CantoLyr", a Cantonese lyrics composition assistant. It's built with a hexagonal architecture, separating the domain logic from the infrastructure. The API provides endpoints for searching Cantonese characters and words by tone patterns, composing lyrical lines with LLM assistance, and recording user feedback.

**Key Technologies:**

* **Backend:** Node.js, Fastify
* **Database:** PostgreSQL with Prisma ORM
* **LLM Integration:** Google Gemini
* **Testing:** Vitest
* **Containerization:** Docker

**Architecture:**

* **Hexagonal Architecture (Ports and Adapters):** The codebase is structured to isolate the core application logic from external concerns.
* **Dependency Injection:** A container class (`src/infrastructure/container/Container.ts`) is used to manage and inject dependencies.
* **CQRS-lite:** The project separates read and write operations, with `PrismaReadingRepository` and `PrismaWriteRepository`.

## Building and Running

### Prerequisites

* Node.js 22+
* Docker and Docker Compose
* pnpm

### Setup & Running

1. **Install dependencies:**

    ```bash
    pnpm install
    ```

2. **Start the database:**

    ```bash
    docker compose up db -d
    ```

3. **Run database migrations:**

    ```bash
    pnpm run db:migrate
    ```

4. **Seed the database:**

    ```bash
    pnpm exec tsx scripts/seed-sample-data.ts
    ```

5. **Start the development server:**

    ```bash
    pnpm run dev
    ```

The API will be available at `http://localhost:3000`.

### Key Scripts

* `pnpm run dev`: Start the development server with hot reload.
* `pnpm test`: Run tests.
* `pnpm run lint`: Lint the code.
* `pnpm run build`: Build the project for production.
* `pnpm run start`: Start the production server.

## Development Conventions

* **Coding Style:** The project uses ESLint to enforce a consistent coding style. The configuration can be found in `.eslintrc.json`.
* **Testing:** Tests are written with Vitest and are located in the `tests` directory. The tests are separated into `unit`, `integration`, and `e2e` tests.
* **Commits:** (No explicit commit message convention found, but can be inferred from `git log` if needed).
* **Branching:** (No explicit branching strategy found).
