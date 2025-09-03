# LLM Integration Guide

## Overview

The CantoLyr API includes intelligent LLM-powered reranking capabilities for Cantonese readings. This feature helps composers find the most appropriate characters and words for their lyrical compositions based on semantic relevance, register, and artistic value.

## Available Implementations

### 1. GeminiLlmReranker (Production)

Uses the official Google Gen AI SDK (`@google/genai`) to integrate with Google's Gemini models.

**Features:**

- Official SDK integration with proper error handling
- Support for Gemini 2.5 models
- Configurable timeouts and retries
- Comprehensive response validation
- Score normalization and filtering

**Configuration:**

```typescript
import { GeminiLlmReranker } from './infrastructure/adapters/llm/GeminiLlmReranker.js';

const reranker = new GeminiLlmReranker({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.5-flash', // Optional, defaults to gemini-2.5-flash
  timeoutMs: 30000, // Optional, defaults to 30 seconds
  maxRetries: 3 // Optional, for future retry logic
});
```

### 2. DummyLlmReranker (Testing/Fallback)

Provides heuristic-based ranking without external API calls.

**Features:**

- Always available (no API dependencies)
- Deterministic scoring based on multiple factors
- Useful for testing and development
- Fallback option when external services are unavailable

**Scoring Factors:**

- Frequency score (0-0.3)
- Register preference (0-0.2)
- Part of speech preference (0-0.2)
- Syllable count matching (0-0.15)
- Entry type preference (0-0.1)
- Language preference (0-0.05)

## Factory Function

Use the factory function for easy instantiation:

```typescript
import { createLlmReranker } from './infrastructure/adapters/llm/index.js';

// Create Gemini reranker
const geminiReranker = createLlmReranker({
  provider: 'gemini',
  apiKey: process.env.GEMINI_API_KEY
});

// Create dummy reranker
const dummyReranker = createLlmReranker({
  provider: 'dummy'
});
```

## Usage Example

```typescript
import type { RerankInput } from './application/ports/LlmReranker.js';

const input: RerankInput = {
  candidates: [
    // Array of ReadingDTO objects
  ],
  tonePattern: '43',
  constraints: {
    theme: 'romantic',
    mood: 'tender'
  },
  context: {
    genre: 'ballad'
  },
  topK: 5
};

const result = await reranker.rerank(input);

if (result.success) {
  console.log('Rankings:', result.rankings);
  console.log('Processing time:', result.processingTimeMs, 'ms');
} else {
  console.error('Error:', result.error);
}
```

## SDK Migration

### From Direct API Calls to Official SDK

The implementation has been migrated from direct HTTP calls to the official Google Gen AI SDK for better reliability and maintainability.

**Benefits of SDK Migration:**

- **Type Safety**: Full TypeScript support with proper interfaces
- **Error Handling**: Built-in error handling and retry logic
- **Maintenance**: Automatic updates and bug fixes from Google
- **Features**: Access to latest Gemini features and models
- **Performance**: Optimized request handling and connection pooling

**Breaking Changes:**

- Default model changed from `gemini-pro` to `gemini-2.5-flash`
- Version info updated to `2.0`
- Improved error messages and timeout handling

### Dependencies

The SDK integration requires:

```json
{
  "dependencies": {
    "@google/genai": "^1.16.0",
    "ajv": "^8.17.1"
  }
}
```

## Environment Setup

Set your Gemini API key as an environment variable:

```bash
export GEMINI_API_KEY="your-api-key-here"
```

Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey).

## Error Handling

The implementation includes comprehensive error handling:

- **Configuration Validation**: Validates API keys and settings
- **Timeout Management**: Configurable request timeouts
- **Response Validation**: JSON schema validation using Ajv
- **Graceful Degradation**: Returns error details for debugging
- **Score Normalization**: Clamps scores to valid [0, 1] range

## Testing

The implementation includes extensive unit tests covering:

- SDK integration and mocking
- Error scenarios and edge cases
- Response parsing and validation
- Timeout and retry behavior
- Score clamping and filtering

Run tests with:

```bash
pnpm test tests/unit/infrastructure/adapters/llm/
```

## Performance Considerations

- **Caching**: Consider implementing response caching for repeated queries
- **Batching**: Group multiple rerank requests when possible
- **Timeouts**: Configure appropriate timeouts based on your use case
- **Fallback**: Use DummyLlmReranker as fallback for high availability

## Future Enhancements

Planned improvements include:

- Support for additional LLM providers (OpenAI, Claude, etc.)
- Response caching and optimization
- Batch processing capabilities
- Advanced prompt engineering
- Fine-tuning support for Cantonese-specific models
