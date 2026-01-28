/**
 * Intuit Compliance Security Middleware
 * 
 * Implements Intuit's strict security requirements:
 * - Cache-Control: no-cache, no-store on all authenticated routes
 * - Secure logging with credential redaction
 * - Sanitized error responses
 */

import { Request, Response, NextFunction } from 'express';
import { intuitSecurityConfig } from '../config/intuit-security';

export function strictCacheControlMiddleware(req: Request, res: Response, next: NextFunction): void {
  const isApiRoute = req.path.startsWith('/api');
  const isAuthenticated = !!(req.session as any)?.userId;
  const isQuickBooksRoute = req.path.includes('/quickbooks') || req.path.includes('/qb');
  
  if (isApiRoute || isAuthenticated || isQuickBooksRoute) {
    res.setHeader('Cache-Control', intuitSecurityConfig.cacheControl.authenticated);
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
}

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  if (req.path.includes('/oauth') || req.path.includes('/callback')) {
    res.setHeader('Referrer-Policy', 'no-referrer');
  }
  
  next();
}

export function redactSensitiveData(data: string): string {
  if (!data) return data;
  
  let redacted = data;
  
  for (const pattern of intuitSecurityConfig.sensitivePatterns) {
    redacted = redacted.replace(pattern, (match) => {
      const parts = match.split(/[:=]/);
      if (parts.length > 1) {
        return `${parts[0]}:[REDACTED]`;
      }
      return '[REDACTED]';
    });
  }
  
  return redacted;
}

export function createSecureLogger() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  
  const secureLog = (...args: any[]) => {
    const redactedArgs = args.map(arg => {
      if (typeof arg === 'string') {
        return redactSensitiveData(arg);
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.parse(redactSensitiveData(JSON.stringify(arg)));
        } catch {
          return arg;
        }
      }
      return arg;
    });
    originalLog.apply(console, redactedArgs);
  };
  
  const secureError = (...args: any[]) => {
    const redactedArgs = args.map(arg => {
      if (typeof arg === 'string') {
        return redactSensitiveData(arg);
      }
      if (arg instanceof Error) {
        const redactedError = new Error(redactSensitiveData(arg.message));
        redactedError.name = arg.name;
        if (arg.stack) {
          redactedError.stack = redactSensitiveData(arg.stack);
        }
        return redactedError;
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.parse(redactSensitiveData(JSON.stringify(arg)));
        } catch {
          return arg;
        }
      }
      return arg;
    });
    originalError.apply(console, redactedArgs);
  };
  
  return {
    enableSecureLogging: () => {
      console.log = secureLog;
      console.error = secureError;
      console.warn = (...args: any[]) => {
        const redactedArgs = args.map(arg => 
          typeof arg === 'string' ? redactSensitiveData(arg) : arg
        );
        originalWarn.apply(console, redactedArgs);
      };
      console.info = (...args: any[]) => {
        const redactedArgs = args.map(arg => 
          typeof arg === 'string' ? redactSensitiveData(arg) : arg
        );
        originalInfo.apply(console, redactedArgs);
      };
    },
    restoreOriginalLogging: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      console.info = originalInfo;
    },
    log: secureLog,
    error: secureError,
  };
}

const secureLogger = createSecureLogger();
export const safeLog = secureLogger.log;
export const safeError = secureLogger.error;

export function initializeSecureLogging(): void {
  secureLogger.enableSecureLogging();
  console.log('[Intuit Security] Secure logging enabled - sensitive data will be redacted (Intuit compliance)');
}

export function oauthCallbackSanitizer(redirectUrl: string) {
  return (req: Request, res: Response): void => {
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    
    res.redirect(302, redirectUrl);
  };
}

export function sanitizedErrorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  const isQuickBooksRoute = req.path.includes('/quickbooks') || req.path.includes('/qb');
  
  if (isQuickBooksRoute) {
    safeError(`[QuickBooks Error] ${err.message}`);
    
    res.status(500).json({
      success: false,
      error: 'An error occurred processing your QuickBooks request',
      code: 'QB_ERROR',
    });
    return;
  }
  
  next(err);
}

export function validateOAuthState(req: Request, expectedState: string): boolean {
  const receivedState = req.query.state as string;
  
  if (!receivedState || !expectedState) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(receivedState),
    Buffer.from(expectedState)
  );
}

import crypto from 'crypto';

export function generateSecureState(): string {
  return crypto.randomBytes(32).toString('hex');
}
