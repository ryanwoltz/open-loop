import { describe, expect, it } from 'vitest';
import { deriveTitle, redactUrl, truncate } from '../src/util';
import { ListQuery, ReportPatch } from '../src/schema';

describe('redactUrl', () => {
  it('masks credential-like query params and keeps the rest', () => {
    const out = redactUrl('https://api.example.com/v1/x?token=abc&page=2&api_key=zzz');
    expect(out).toContain('token=REDACTED');
    expect(out).toContain('api_key=REDACTED');
    expect(out).toContain('page=2');
    expect(out).not.toContain('abc');
  });

  it('strips userinfo', () => {
    expect(redactUrl('https://bob:hunter2@example.com/')).toBe('https://example.com/');
  });

  it('returns unparseable input unchanged', () => {
    expect(redactUrl('/relative?token=1')).toBe('/relative?token=1');
  });

  it('returns the identical string when nothing is sensitive', () => {
    const raw = 'https://example.com/a?b=1';
    expect(redactUrl(raw)).toBe(raw);
  });
});

describe('truncate / deriveTitle', () => {
  it('truncates with an ellipsis at the limit', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });

  it('uses the first non-empty comment, collapsed', () => {
    expect(deriveTitle(['  ', 'Button\n  is   blue'], 'Page')).toBe('Button is blue');
  });

  it('falls back to the page title, then a placeholder', () => {
    expect(deriveTitle([], 'Checkout')).toBe('Checkout');
    expect(deriveTitle([], '  ')).toBe('Untitled report');
  });
});

describe('schemas', () => {
  it('ListQuery defaults and coerces the limit', () => {
    expect(ListQuery.parse({ limit: '5' })).toEqual({ status: 'all', limit: 5 });
  });

  it('ReportPatch rejects unknown keys', () => {
    expect(ReportPatch.safeParse({ status: 'resolved', id: 'x' }).success).toBe(false);
  });
});

import { redactBody } from '../src/redact';

describe('redactBody', () => {
  it('masks sensitive JSON keys at any depth', () => {
    const out = JSON.parse(redactBody('{"email":"a@b.c","password":"x","card":{"number":"4242"},"items":[{"apiKey":"k"}]}'));
    expect(out).toEqual({ email: 'a@b.c', password: 'REDACTED', card: 'REDACTED', items: [{ apiKey: 'REDACTED' }] });
  });

  it('masks form-encoded fields', () => {
    expect(redactBody('user=bob&pass=hunter2')).toBe('user=bob&pass=REDACTED');
  });

  it('truncates plain text', () => {
    expect(redactBody('x'.repeat(50), 10)).toHaveLength(10);
  });
});

import { isFailedRequest } from '../src/core';

describe('isFailedRequest', () => {
  it('counts errors but not page-cancelled requests', () => {
    expect(isFailedRequest({ ok: false })).toBe(true);
    expect(isFailedRequest({ ok: false, aborted: true })).toBe(false);
    expect(isFailedRequest({ ok: false, error: 'Aborted' })).toBe(false); // reports from before the flag
    expect(isFailedRequest({ ok: true })).toBe(false);
  });
});
