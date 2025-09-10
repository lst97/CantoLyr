# Configuration Guide

CantoLyr API uses a flexible configuration system that supports both hardcoded MVP settings and
environment-based configuration.

## Quick Start (MVP)

For rapid development and testing, the application uses hardcoded configuration by default:

```bash
npm run start:dev
```

This will use the MVP configuration with:

- **Database**: Local PostgreSQL (localhost:5432)
- **LLM Provider**: Dummy (no API costs)
- **Cache**: In-memory
- **Server**: Port 3000

## Environment Variables

Copy `.env.example` to `.env` and customize as needed:

```bash
cp .env.example .env
```

### Key Configuration Options

#### Database

```env
DATABASE_URL=postgresql://cantolyr:cantolyr@localhost:5432/cantolyr_dev
DB_MAX_CONNECTIONS=10
DB_CONNECTION_TIMEOUT=30000
DB_QUERY_TIMEOUT=10000
DB_LOG_QUERIES=true
```

#### LLM Provider

```env
# Use 'dummy' for development (no API costs)
LLM_PROVIDER=dummy

# Use 'gemini' for production (requires API key)
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
# Default: gemini-2.5-flash. To reduce rate limits, you can use Flash-Lite
# e.g. LLM_MODEL=gemini-2.5-flash-lite
LLM_MODEL=gemini-2.5-flash
# Optional: enable automatic fallback to Flash-Lite on rate limit (default true)
LLM_ENABLE_FALLBACK=true
LLM_MAX_RETRIES=2
```

#### Cache

```env
# Use 'memory' for MVP
CACHE_TYPE=memory
CACHE_DEFAULT_TTL=300
CACHE_MAX_SIZE=1000

# Use 'redis' for production (future)
# CACHE_TYPE=redis
# REDIS_URL=redis://localhost:6379
```

#### Server

```env
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
ENABLE_SWAGGER=true
CORS_ENABLED=true
REQUEST_TIMEOUT=60000
```

- REQUEST_TIMEOUT: Max time in ms the API server allows a request to run before timing out. Increase
  this if LLM calls can take longer.

Note: LLM requests have their own timeout controlled by `LLM_TIMEOUT_MS` (see LLM Provider section).
Ensure both values are set high enough for your workload.

## Configuration Modes

### MVP Mode (Default)

- **Environment**: development, test
- **Purpose**: Quick iteration and development
- **Features**: Hardcoded settings, dummy LLM, in-memory cache
- **Usage**: `npm run start:dev`

### Production Mode

- **Environment**: production
- **Purpose**: Production deployment
- **Features**: Environment-based config, real LLM, configurable cache
- **Usage**: `NODE_ENV=production npm start`

## Health Checks

The application provides health checks for all services:

```bash
curl http://localhost:3000/health
```

Returns status for:

- Database connectivity
- Cache functionality
- LLM service availability
- Overall system health

## Configuration Validation

All configuration is validated using Zod schemas. Invalid configurations will cause startup failures
with detailed error messages.

## Development Tips

1. **Quick Testing**: Use dummy LLM provider to avoid API costs
2. **Database Setup**: Ensure PostgreSQL is running locally
3. **Environment Isolation**: Use different `.env` files for different environments
4. **Hot Reload**: Use `npm run dev` for automatic restarts during development

## Troubleshooting

### Database Connection Issues

- Verify PostgreSQL is running: `pg_isready`
- Check connection string format
- Ensure database exists: `createdb cantolyr_dev`

### LLM Provider Issues

- For Gemini: Verify API key is valid
- For development: Use `LLM_PROVIDER=dummy`
- Check network connectivity for API calls

### Cache Issues

- Memory cache: No external dependencies
- Redis cache: Ensure Redis server is running

## Security Notes

- Never commit `.env` files to version control
- Use strong database passwords in production
- Rotate API keys regularly
- Use environment-specific configurations
