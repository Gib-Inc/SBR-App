/**
 * Intuit Compliance Security Configuration
 * 
 * This configuration file follows Intuit's strict security requirements:
 * - Encryption key loaded from separate config (not hardcoded)
 * - AES-256 encryption for OAuth tokens and realmID
 * - Strict caching and cookie policies
 * 
 * IMPORTANT: The QB_ENCRYPTION_KEY must be a 32-byte (256-bit) key
 * encoded as a 64-character hex string.
 */

export interface IntuitSecurityConfig {
  encryptionKey: Buffer;
  encryptionAlgorithm: 'aes-256-gcm';
  ivLength: number;
  authTagLength: number;
  cookieSettings: {
    secure: true;
    httpOnly: true;
    sameSite: 'lax' | 'strict' | 'none';
  };
  cacheControl: {
    authenticated: 'no-cache, no-store';
    public: 'public, max-age=86400';
  };
  sensitivePatterns: RegExp[];
}

function loadEncryptionKey(): Buffer {
  const keyHex = process.env.QB_ENCRYPTION_KEY;
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!keyHex) {
    if (isProduction) {
      throw new Error(
        '[Intuit Security] CRITICAL: QB_ENCRYPTION_KEY is required in production for Intuit compliance. ' +
        'Generate a secure key with: openssl rand -hex 32'
      );
    }
    console.warn('[Intuit Security] QB_ENCRYPTION_KEY not set - token encryption will use fallback key');
    console.warn('[Intuit Security] Generate a secure key with: openssl rand -hex 32');
    console.warn('[Intuit Security] WARNING: This is NOT acceptable for production - set QB_ENCRYPTION_KEY before deploying');
    const fallbackKey = Buffer.alloc(32, 0);
    return fallbackKey;
  }
  
  if (keyHex.length !== 64) {
    throw new Error(
      `[Intuit Security] QB_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ` +
      `Got ${keyHex.length} characters. Generate with: openssl rand -hex 32`
    );
  }
  
  if (!/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new Error('[Intuit Security] QB_ENCRYPTION_KEY must contain only hexadecimal characters');
  }
  
  return Buffer.from(keyHex, 'hex');
}

export function isEncryptionKeyConfigured(): boolean {
  return !!process.env.QB_ENCRYPTION_KEY && process.env.QB_ENCRYPTION_KEY.length === 64;
}

const sensitiveDataPatterns: RegExp[] = [
  /access_token["\s:=]+["\']?[A-Za-z0-9\-_\.]+/gi,
  /refresh_token["\s:=]+["\']?[A-Za-z0-9\-_\.]+/gi,
  /bearer\s+[A-Za-z0-9\-_\.]+/gi,
  /realmId["\s:=]+["\']?\d+/gi,
  /realm_id["\s:=]+["\']?\d+/gi,
  /client_secret["\s:=]+["\']?[A-Za-z0-9\-_]+/gi,
  /password["\s:=]+["\']?[^\s"',}]+/gi,
  /secret["\s:=]+["\']?[A-Za-z0-9\-_]+/gi,
  /api_key["\s:=]+["\']?[A-Za-z0-9\-_]+/gi,
  /apikey["\s:=]+["\']?[A-Za-z0-9\-_]+/gi,
  /authorization["\s:=]+["\']?[A-Za-z0-9\-_\s]+/gi,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b\d{2}-\d{7}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
];

export const intuitSecurityConfig: IntuitSecurityConfig = {
  encryptionKey: loadEncryptionKey(),
  encryptionAlgorithm: 'aes-256-gcm',
  ivLength: 12,
  authTagLength: 16,
  cookieSettings: {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  },
  cacheControl: {
    authenticated: 'no-cache, no-store',
    public: 'public, max-age=86400',
  },
  sensitivePatterns: sensitiveDataPatterns,
};

export function reloadEncryptionKey(): void {
  (intuitSecurityConfig as any).encryptionKey = loadEncryptionKey();
}

export function validateSecurityConfig(): { valid: boolean; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  
  if (!process.env.QB_ENCRYPTION_KEY) {
    warnings.push('QB_ENCRYPTION_KEY not set - using insecure fallback key');
  }
  
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    warnings.push('SESSION_SECRET should be at least 32 characters for production');
  }
  
  if (intuitSecurityConfig.encryptionKey.equals(Buffer.alloc(32, 0))) {
    errors.push('Encryption key is using insecure fallback - set QB_ENCRYPTION_KEY in production');
  }
  
  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
