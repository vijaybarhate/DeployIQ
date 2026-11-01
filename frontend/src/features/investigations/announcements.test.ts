import { describe, expect, it } from 'vitest';

import type { Investigation } from '../../types/api';
import { computeAnnouncements } from './announcements';

type Item = Pick<Investigation, 'id' | 'status'>;

function inv(id: string, status: Investigation['status']): Item {
  return { id, status };
}

describe('computeAnnouncements', () => {
  it('stays silent on initial hydration', () => {
    const seen = new Map<string, Investigation['status']>();
    const { messages } = computeAnnouncements(
      seen,
      [inv('aaaaaaaa-0000', 'completed'), inv('bbbbbbbb-0000', 'running')],
      new Set(),
    );
    expect(messages).toEqual([]);
    expect(seen.get('aaaaaaaa-0000')).toBe('completed');
  });

  it('announces newly POST-created investigations with their short id', () => {
    const seen = new Map<string, Investigation['status']>();
    const { messages } = computeAnnouncements(seen, [inv('a1b2c3d4e5f6', 'pending')], new Set(['a1b2c3d4e5f6']));
    expect(messages).toEqual(['Investigation a1b2c3d4 queued.']);
  });

  it('does not announce historical records even when other ids were created', () => {
    const seen = new Map<string, Investigation['status']>();
    const { messages } = computeAnnouncements(seen, [inv('a1b2c3d4', 'running')], new Set(['other']));
    expect(messages).toEqual([]);
  });

  it('announces transitions but not repeats', () => {
    const seen = new Map<string, Investigation['status']>([['a1b2c3d4', 'pending']]);
    expect(computeAnnouncements(seen, [inv('a1b2c3d4', 'running')], new Set()).messages).toEqual([
      'Investigation a1b2c3d4 started.',
    ]);
    expect(computeAnnouncements(seen, [inv('a1b2c3d4', 'running')], new Set()).messages).toEqual([]);
    expect(computeAnnouncements(seen, [inv('a1b2c3d4', 'completed')], new Set()).messages).toEqual([
      'Investigation a1b2c3d4 completed.',
    ]);
  });

  it('announces sequential completions with identical status across polls', () => {
    const seen = new Map<string, Investigation['status']>();
    const first = computeAnnouncements(seen, [inv('aaaaaaaa', 'completed')], new Set(['aaaaaaaa']));
    expect(first.messages).toEqual(['Investigation aaaaaaaa completed.']);
    // A later poll: a different investigation finishes — announced despite same wording shape.
    const second = computeAnnouncements(
      seen,
      [inv('aaaaaaaa', 'completed'), inv('bbbbbbbb', 'completed')],
      new Set(['bbbbbbbb']),
    );
    expect(second.messages).toEqual(['Investigation bbbbbbbb completed.']);
  });

  it('prunes investigations that disappeared', () => {
    const seen = new Map<string, Investigation['status']>([['gone', 'completed']]);
    computeAnnouncements(seen, [], new Set());
    expect(seen.has('gone')).toBe(false);
  });
});
