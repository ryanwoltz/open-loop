import { truncate } from './core';

const SENSITIVE_KEY =
  /pass(word|wd|phrase)?|secret|token|api[-_]?key|auth|credential|session|cookie|card|cvv|cvc|ssn|social|iban|account[-_]?number|routing|pin$|otp|signature/i;

const mask = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? 'REDACTED' : mask(v)]),
    );
  }
  return value;
};

/**
 * Redacts credential-looking fields from a captured request/response body.
 * JSON and form-encoded bodies are redacted by key; anything else is kept
 * verbatim but truncated.
 */
export const redactBody = (body: string, max = 4000): string => {
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return truncate(JSON.stringify(mask(JSON.parse(trimmed))), max);
    } catch {
      /* not JSON after all */
    }
  }
  if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed)) {
    try {
      const params = new URLSearchParams(trimmed);
      for (const k of [...params.keys()]) if (SENSITIVE_KEY.test(k)) params.set(k, 'REDACTED');
      return truncate(params.toString(), max);
    } catch {
      /* fall through */
    }
  }
  return truncate(body, max);
};
