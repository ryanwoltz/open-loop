import { describe, expect, it } from 'vitest';
import { formatArgs, formatValue } from '../src/main-world/serialize';

describe('formatArgs', () => {
  it('applies printf substitutions and drops %c styles', () => {
    expect(formatArgs(['%s has %d items %c!', 'cart', 3.7, 'color:red'])).toBe('cart has 3 items !');
  });

  it('joins extra args like devtools', () => {
    expect(formatArgs(['a', 1, { b: 2 }])).toBe('a 1 {"b":2}');
  });

  it('survives cycles, errors, nodes, maps and deep nesting', () => {
    const o: Record<string, unknown> = { name: 'x' };
    o.self = o;
    expect(formatValue(o)).toBe('{"name":"x","self":"[Circular]"}');
    expect(formatValue(new TypeError('boom'))).toBe('TypeError: boom');
    const div = document.createElement('div');
    div.id = 'a';
    div.className = 'b c';
    expect(formatValue(div)).toBe('<div#a.b.c>');
    expect(formatValue(new Map([['k', 1]]))).toBe('{"Map(1)":{"k":1}}');
    expect(formatValue({ a: { b: { c: { d: 1 } } } })).toBe('{"a":{"b":{"c":"[Object]"}}}');
  });

  it('does not throw on throwing getters', () => {
    const o = {};
    Object.defineProperty(o, 'bad', { enumerable: true, get: () => { throw new Error('no'); } });
    expect(formatValue(o)).toBe('{"bad":"[Threw]"}');
  });

  it('truncates long output', () => {
    expect(formatArgs(['x'.repeat(100)], 10)).toHaveLength(10);
  });
});
