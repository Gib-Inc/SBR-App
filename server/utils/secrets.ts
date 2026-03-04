export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) {
    return null;
  }
  
  const trimmed = secret.trim();
  if (!trimmed) {
    return null;
  }
  
  // For Anthropic keys (sk-ant-...), show prefix + last 4 for confirmation
  if (trimmed.startsWith('sk-ant-')) {
    return `sk-ant-••••••••${trimmed.slice(-4)}`;
  }
  
  // For other keys, show first 4 + last 4
  if (trimmed.length <= 8) {
    const first = trimmed.slice(0, Math.min(3, trimmed.length));
    const last = trimmed.length > 3 ? trimmed.slice(-Math.min(3, trimmed.length - 3)) : '';
    return `${first}••••${last}`;
  }
  
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}
