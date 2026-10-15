/** Dependency-free helpers safe to bundle into page scripts (no zod). */

import type { ComponentFrame } from './schema';

export const DEFAULT_PORT = 7865;
export const DEFAULT_SERVER_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

/**
 * Every API request must carry this header. Browsers cannot attach a custom
 * header to an <img>, a form post or a no-cors fetch, and a cross-origin fetch
 * that sets it triggers a preflight the server refuses for web origins, so a
 * web page cannot read or write the local store.
 */
export const API_HEADER = 'x-open-loop';
export const API_HEADER_VALUE = '1';

export const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;

const SENSITIVE_PARAM =
  /^(access[_-]?token|id[_-]?token|refresh[_-]?token|token|auth|authorization|api[_-]?key|apikey|key|secret|client[_-]?secret|password|passwd|pwd|session|sessionid|sig|signature|code|x-amz-signature|x-amz-credential|x-amz-security-token)$/i;

/** Masks query-string values whose names look like credentials. */
export const redactUrl = (raw: string): string => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  let changed = false;
  for (const name of [...url.searchParams.keys()]) {
    if (SENSITIVE_PARAM.test(name)) {
      url.searchParams.set(name, 'REDACTED');
      changed = true;
    }
  }
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
    changed = true;
  }
  return changed ? url.toString() : raw;
};

/** A title from the first annotation comment when the user gave none. */
export const deriveTitle = (comments: string[], pageTitle: string): string => {
  const first = comments.map((c) => c.trim()).find((c) => c.length > 0);
  const base = first ?? (pageTitle.trim() || 'Untitled report');
  return truncate(base.replace(/\s+/g, ' '), 120);
};

const SHORT = /^[A-Za-z_$][\w$]{0,2}$/;

/**
 * Production bundles rename components to 1–3 character identifiers (v2t, Ln,
 * kIt). A chain that is mostly such names is minified: its short names say
 * nothing about the source, so they are dropped and the result is flagged.
 */
export const dropMinified = (frames: ComponentFrame[]): { frames: ComponentFrame[]; minified: boolean } => {
  const short = frames.filter((f) => SHORT.test(f.name)).length;
  if (frames.length < 3 || short / frames.length < 0.6) return { frames, minified: false };
  return { frames: frames.filter((f) => !SHORT.test(f.name)), minified: true };
};
