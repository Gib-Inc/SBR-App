export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) {
    return null;
  }
  
  const trimmed = secret.trim();
  if (!trimmed) {
    return null;
  }
  
  if (trimmed.length <= 6) {
    return `${trimmed.charAt(0)}***${trimmed.charAt(trimmed.length - 1)}`;
  }
  
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-3)}`;
}
