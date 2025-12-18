export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) {
    return null;
  }
  
  const trimmed = secret.trim();
  if (!trimmed) {
    return null;
  }
  
  // Always use first3***last3 format, padding short secrets as needed
  if (trimmed.length <= 6) {
    // For very short secrets, show what we can but maintain the format
    const first = trimmed.slice(0, Math.min(3, trimmed.length));
    const last = trimmed.length > 3 ? trimmed.slice(-Math.min(3, trimmed.length - 3)) : '';
    return `${first}***${last}`;
  }
  
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-3)}`;
}
