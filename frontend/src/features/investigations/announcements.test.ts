import { describe, expect, it } from 'vitest';

import type { Investigation } from '../../types/api';
import { computeAnnouncements, MAX_CREATED_MISSES, pruneCreatedIds } from './announcements';

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

describe('pruneCreatedIds', () => {
  it('removes announced ids and their miss counters', () => {
    const created = new Set(['a', 'b']);
    const misses = new Map([['a', 3]]);
    pruneCreatedIds(created, misses, new Set(['a', 'b']), new Set(['a']));
    expect(created.has('a')).toBe(false);
    expect(misses.has('a')).toBe(false);
    expect(created.has('b')).toBe(true);
  });

  it('keeps legitimate pending ids that are present without counting a miss', () => {
    const created = new Set(['pending-1']);
    const misses = new Map<string, number>();
    pruneCreatedIds(created, misses, new Set(['pending-1']), new Set());
    expect(created.has('pending-1')).toBe(true);
    expect(misses.has('pending-1')).toBe(false);
  });

  it('drops ids that never appear after the miss cap', () => {
    const created = new Set(['ghost']);
    const misses = new Map<string, number>();
    for (let i = 0; i < MAX_CREATED_MISSES; i += 1) {
      pruneCreatedIds(created, misses, new Set(), new Set());
    }
    expect(created.has('ghost')).toBe(false);
    expect(misses.has('ghost')).toBe(false);
  });

  it('does not drop a pending id before the cap', () => {
    const created = new Set(['ghost']);
    const misses = new Map<string, number>();
    for (let i = 0; i < MAX_CREATED_MISSES - 1; i += 1) {
      pruneCreatedIds(created, misses, new Set(), new Set());
    }
    expect(created.has('ghost')).toBe(true);
  });
});
