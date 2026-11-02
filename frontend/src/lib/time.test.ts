import { describe, expect, it } from 'vitest';

import { parseInstant, elapsedSeconds, formatElapsed, formatDateTime, formatClockTime } from './time';

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

describe('formatDateTime', () => {
  it('renders timestamps as short local date plus time', () => {
    const out = formatDateTime('2026-11-01T14:16:06.263475');
    expect(out).toMatch(/^\d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 2026, \d{2}:\d{2}$/);
    expect(out).not.toContain('T');
  });
  it('never fabricates: passes invalid input through', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });
});

describe('formatClockTime', () => {
  it('renders local HH:MM:SS and never fabricates', () => {
    expect(formatClockTime(Date.parse('2026-11-01T14:16:05'))).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatClockTime(null)).toBe('—');
    expect(formatClockTime(undefined)).toBe('—');
    expect(formatClockTime(Number.NaN)).toBe('—');
  });
});
