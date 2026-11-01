import { describe, expect, it } from 'vitest';

import type { Investigation } from '../../types/api';
import { announcementText, computeAnnouncements } from './announcements';

type Item = Pick<Investigation, 'id' | 'status'>;

function inv(id: string, status: Investigation['status']): Item {
  return { id, status };
}

describe('computeAnnouncements', () => {
  it('stays silent on initial hydration', () => {
    const seen = new Map<string, Investigation['status']>();
    const { messages } = computeAnnouncements(seen, [inv('a', 'completed'), inv('b', 'running')], new Set());
    expect(messages).toEqual([]);
    expect(seen.get('a')).toBe('completed');
    expect(seen.get('b')).toBe('running');
  });

  it('announces newly POST-created investigations immediately', () => {
    const seen = new Map<string, Investigation['status']>();
    const { messages } = computeAnnouncements(seen, [inv('a', 'pending')], new Set(['a']));
    expect(messages).toEqual(['Investigation queued.']);
  });

  it('does not announce historical records even with create-set present', () => {
    const seen = new Map<string, Investigation['status']>();
    const { messages } = computeAnnouncements(seen, [inv('a', 'running')], new Set(['other']));
    expect(messages).toEqual([]);
  });

  it('announces transitions but not repeats', () => {
    const seen = new Map<string, Investigation['status']>([['a', 'pending']]);
    expect(computeAnnouncements(seen, [inv('a', 'running')], new Set()).messages).toEqual([
      'Investigation started.',
    ]);
    expect(computeAnnouncements(seen, [inv('a', 'running')], new Set()).messages).toEqual([]);
    expect(computeAnnouncements(seen, [inv('a', 'completed')], new Set()).messages).toEqual([
      'Investigation completed.',
    ]);
  });

  it('announces each investigation separately even with identical text', () => {
    const seen = new Map<string, Investigation['status']>();
    computeAnnouncements(seen, [inv('a', 'running')], new Set(['a']));
    const { messages } = computeAnnouncements(seen, [inv('a', 'completed'), inv('b', 'completed')], new Set(['b']));
    expect(messages).toEqual(['Investigation completed.', 'Investigation completed.']);
  });

  it('prunes investigations that disappeared', () => {
    const seen = new Map<string, Investigation['status']>([['gone', 'completed']]);
    computeAnnouncements(seen, [], new Set());
    expect(seen.has('gone')).toBe(false);
  });

  it('maps every lifecycle status to a message', () => {
    const cases: Array<[Investigation['status'], string]> = [
      ['pending', 'queued'],
      ['running', 'started'],
      ['completed', 'completed.'],
      ['insufficient_evidence', 'insufficient evidence'],
      ['failed', 'failed.'],
      ['validation_failed', 'validation failed'],
    ];
    for (const [status, text] of cases) {
      expect(announcementText(status)).toContain(text);
    }
  });
});
