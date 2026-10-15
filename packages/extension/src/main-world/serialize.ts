/**
 * Turns console arguments into one readable line, the way devtools would print
 * them, without throwing on cycles, getters, DOM nodes or huge objects.
 */
const MAX_DEPTH = 3;
const MAX_KEYS = 30;
const MAX_ITEMS = 30;

const describeNode = (n: Node): string => {
  if (n instanceof Element) {
    const id = n.id ? `#${n.id}` : '';
    const cls = typeof n.className === 'string' && n.className.trim() ? `.${n.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
    return `<${n.tagName.toLowerCase()}${id}${cls}>`;
  }
  if (n.nodeType === Node.TEXT_NODE) return `#text "${(n.textContent ?? '').slice(0, 40)}"`;
  return `[${n.nodeName}]`;
};

const toPlain = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return `${String(value)}n`;
  if (t === 'symbol') return String(value);
  if (t === 'function') return `ƒ ${(value as { name?: string }).name || 'anonymous'}()`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof Node !== 'undefined' && value instanceof Node) return describeNode(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof RegExp) return String(value);
  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(obj) ? `[Array(${obj.length})]` : '[Object]';
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items = obj.slice(0, MAX_ITEMS).map((v) => toPlain(v, depth + 1, seen));
      if (obj.length > MAX_ITEMS) items.push(`… ${obj.length - MAX_ITEMS} more`);
      return items;
    }
    if (obj instanceof Map) {
      return { [`Map(${obj.size})`]: toPlain(Object.fromEntries([...obj.entries()].slice(0, MAX_KEYS)), depth + 1, seen) };
    }
    if (obj instanceof Set) return { [`Set(${obj.size})`]: toPlain([...obj].slice(0, MAX_ITEMS), depth + 1, seen) };
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (const k of keys.slice(0, MAX_KEYS)) {
      try {
        out[k] = toPlain((obj as Record<string, unknown>)[k], depth + 1, seen);
      } catch {
        out[k] = '[Threw]';
      }
    }
    if (keys.length > MAX_KEYS) out['…'] = `${keys.length - MAX_KEYS} more keys`;
    return out;
  } finally {
    seen.delete(obj);
  }
};

export const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  const plain = toPlain(value, 0, new WeakSet());
  if (typeof plain === 'string') return plain;
  try {
    return JSON.stringify(plain);
  } catch {
    return String(plain);
  }
};

/** Applies printf-style %s %d %i %f %o %O %c substitutions in the first argument. */
export const formatArgs = (args: unknown[], max = 4000): string => {
  if (args.length === 0) return '';
  let rest = args;
  let head = '';
  if (typeof args[0] === 'string' && /%[sdifoOc]/.test(args[0])) {
    let i = 1;
    head = args[0].replace(/%([sdifoOc%])/g, (m, f: string) => {
      if (f === '%') return '%';
      if (i >= args.length) return m;
      const v = args[i++];
      if (f === 'c') return '';
      if (f === 'd' || f === 'i') return String(Number.parseInt(String(v), 10));
      if (f === 'f') return String(Number(v));
      return formatValue(v);
    });
    rest = args.slice(i);
  } else {
    head = formatValue(args[0]);
    rest = args.slice(1);
  }
  const line = [head, ...rest.map(formatValue)].join(' ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
