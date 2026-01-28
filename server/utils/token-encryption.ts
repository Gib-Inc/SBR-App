/**
 * AES-256-GCM Token Encryption Utility
 * 
 * Implements Intuit-compliant encryption for OAuth tokens and realmID.
 * Uses AES-256-GCM with authenticated encryption to prevent tampering.
 * 
 * Key Requirements (Intuit Compliance):
 * - Encryption key loaded from separate configuration file
 * - AES-256 algorithm (256-bit key)
 * - Authenticated encryption (GCM mode)
 * - Unique IV per encryption operation
 */

import crypto from 'crypto';
import { intuitSecurityConfig } from '../config/intuit-security';

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
  version: number;
}

const ENCRYPTION_VERSION = 1;

export function encryptToken(plaintext: string): string {
  if (!plaintext) {
    return '';
  }

  const iv = crypto.randomBytes(intuitSecurityConfig.ivLength);
  
  const cipher = crypto.createCipheriv(
    intuitSecurityConfig.encryptionAlgorithm,
    intuitSecurityConfig.encryptionKey,
    iv,
    { authTagLength: intuitSecurityConfig.authTagLength }
  );

  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();

  const encryptedData: EncryptedData = {
    ciphertext,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    version: ENCRYPTION_VERSION,
  };

  return Buffer.from(JSON.stringify(encryptedData)).toString('base64');
}

export function decryptToken(encryptedString: string): string {
  if (!encryptedString) {
    return '';
  }

  try {
    if (!encryptedString.startsWith('eyJ')) {
      return encryptedString;
    }

    const encryptedData: EncryptedData = JSON.parse(
      Buffer.from(encryptedString, 'base64').toString('utf8')
    );

    if (encryptedData.version !== ENCRYPTION_VERSION) {
      console.warn(`[TokenEncryption] Unknown encryption version: ${encryptedData.version}`);
    }

    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');
    
    const decipher = crypto.createDecipheriv(
      intuitSecurityConfig.encryptionAlgorithm,
      intuitSecurityConfig.encryptionKey,
      iv,
      { authTagLength: intuitSecurityConfig.authTagLength }
    );
    
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(encryptedData.ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  } catch (error) {
    console.error('[TokenEncryption] Decryption failed - token may be corrupted or key changed');
    throw new Error('Token decryption failed - please re-authenticate with QuickBooks');
  }
}

export function isEncrypted(value: string): boolean {
  if (!value) return false;
  
  try {
    if (!value.startsWith('eyJ')) return false;
    
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    
    return (
      parsed.ciphertext !== undefined &&
      parsed.iv !== undefined &&
      parsed.authTag !== undefined &&
      parsed.version !== undefined
    );
  } catch {
    return false;
  }
}

export function encryptRealmId(realmId: string): string {
  return encryptToken(realmId);
}

export function decryptRealmId(encryptedRealmId: string): string {
  return decryptToken(encryptedRealmId);
}

export interface EncryptedTokenSet {
  accessToken: string;
  refreshToken: string;
  realmId: string;
}

export function encryptTokenSet(
  accessToken: string,
  refreshToken: string,
  realmId: string
): EncryptedTokenSet {
  return {
    accessToken: encryptToken(accessToken),
    refreshToken: encryptToken(refreshToken),
    realmId: encryptToken(realmId),
  };
}

export function decryptTokenSet(encrypted: EncryptedTokenSet): {
  accessToken: string;
  refreshToken: string;
  realmId: string;
} {
  return {
    accessToken: decryptToken(encrypted.accessToken),
    refreshToken: decryptToken(encrypted.refreshToken),
    realmId: decryptToken(encrypted.realmId),
  };
}

export function rotateEncryptionKey(
  encryptedValue: string,
  oldKey: Buffer,
  newKey: Buffer
): string {
  const iv = crypto.randomBytes(intuitSecurityConfig.ivLength);
  
  const encryptedData: EncryptedData = JSON.parse(
    Buffer.from(encryptedValue, 'base64').toString('utf8')
  );
  
  const oldIv = Buffer.from(encryptedData.iv, 'base64');
  const oldAuthTag = Buffer.from(encryptedData.authTag, 'base64');
  
  const decipher = crypto.createDecipheriv(
    intuitSecurityConfig.encryptionAlgorithm,
    oldKey,
    oldIv,
    { authTagLength: intuitSecurityConfig.authTagLength }
  );
  decipher.setAuthTag(oldAuthTag);
  
  let plaintext = decipher.update(encryptedData.ciphertext, 'base64', 'utf8');
  plaintext += decipher.final('utf8');
  
  const cipher = crypto.createCipheriv(
    intuitSecurityConfig.encryptionAlgorithm,
    newKey,
    iv,
    { authTagLength: intuitSecurityConfig.authTagLength }
  );
  
  let newCiphertext = cipher.update(plaintext, 'utf8', 'base64');
  newCiphertext += cipher.final('base64');
  
  const newAuthTag = cipher.getAuthTag();
  
  const newEncryptedData: EncryptedData = {
    ciphertext: newCiphertext,
    iv: iv.toString('base64'),
    authTag: newAuthTag.toString('base64'),
    version: ENCRYPTION_VERSION,
  };
  
  return Buffer.from(JSON.stringify(newEncryptedData)).toString('base64');
}
