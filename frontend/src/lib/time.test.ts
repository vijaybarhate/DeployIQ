import { describe, expect, it } from 'vitest';

import { parseInstant, elapsedSeconds, formatElapsed } from './time';

describe('parseInstant', () => {
  it('parses ISO timestamps to epoch ms', () => {
    expect(parseInstant('2026-01-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });
  it('rejects missing and invalid input', () => {
    expect(parseInstant(null)).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
    expect(parseInstant('')).toBeNull();
    expect(parseInstant('not-a-date')).toBeNull();
    expect(parseInstant(123 as unknown as string)).toBeNull();
  });
});

describe('elapsedSeconds', () => {
  it('computes whole elapsed seconds', () => {
    expect(elapsedSeconds(1000, 6500)).toBe(5);
    expect(elapsedSeconds(1000, 1000)).toBe(0);
  });
  it('returns null for missing timestamps or clock skew', () => {
    expect(elapsedSeconds(null, 1000)).toBeNull();
    expect(elapsedSeconds(5000, 1000)).toBeNull();
  });
});

describe('formatElapsed', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatElapsed(null)).toBe('—');
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(45)).toBe('45s');
    expect(formatElapsed(60)).toBe('1m');
    expect(formatElapsed(95)).toBe('1m 35s');
    expect(formatElapsed(3600)).toBe('1h 0m');
    expect(formatElapsed(3723)).toBe('1h 2m');
  });
});
