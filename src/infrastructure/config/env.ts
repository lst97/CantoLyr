import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Load environment variables from .env file if it exists
 * This is a simple implementation for MVP - in production you might use dotenv
 */
export function loadEnvFile(): void {
  try {
    const envPath = join(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    
    // Parse .env file content
    const lines = envContent.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }
      
      // Parse key=value pairs
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex === -1) {
        continue;
      }
      
      const key = trimmedLine.substring(0, equalIndex).trim();
      const value = trimmedLine.substring(equalIndex + 1).trim();
      
      // Remove quotes if present
      const cleanValue = value.replace(/^["']|["']$/g, '');
      
      // Only set if not already defined
      if (!process.env[key]) {
        process.env[key] = cleanValue;
      }
    }
    
    console.log('Environment variables loaded from .env file');
  } catch (error) {
    // .env file doesn't exist or can't be read - this is fine
    console.log('No .env file found, using system environment variables');
  }
}

/**
 * Get required environment variable or throw error
 */
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Get optional environment variable with default value
 */
export function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Get secret value from environment with stricter handling.
 * - Does not print secrets.
 * - Can be marked optional to avoid throwing.
 */
export function getSecret(
  key: string,
  options: { required?: boolean; allowEmpty?: boolean } = {}
): string | undefined {
  const { required = true, allowEmpty = false } = options;
  const value = process.env[key];
  if (value === undefined || value === null) {
    if (required) throw new Error(`Required secret ${key} is not set`);
    return undefined;
  }
  if (!allowEmpty && value.trim() === '') {
    if (required) throw new Error(`Required secret ${key} is empty`);
    return undefined;
  }
  return value;
}

/**
 * Get environment variable as number
 */
export function getEnvAsNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(`Environment variable ${key} is not a valid number, using default: ${defaultValue}`);
    return defaultValue;
  }
  
  return parsed;
}

/**
 * Get environment variable as boolean
 */
export function getEnvAsBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  
  return value.toLowerCase() === 'true';
}
