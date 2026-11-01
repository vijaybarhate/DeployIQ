import { describe, expect, it } from 'vitest';

import { isSafeHttpUrl } from './urls';

describe('isSafeHttpUrl', () => {
  const accepted = [
    'https://example.com/docs',
    'http://example.com/docs',
    'HTTPS://EXAMPLE.COM/docs',
    '  https://example.com/docs  ',
    'http://example.com:8080/a?b=c#frag',
  ];
  it.each(accepted)('accepts %s', (url) => {
    expect(isSafeHttpUrl(url)).toBe(true);
  });

  const rejected = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<h1>x</h1>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    '//example.com/path',
    '/relative/path',
    'relative/path',
    '',
    '   ',
    '\nhttps://example.com/docs',
    'https://example.com/docs\t',
    '\r\nhttps://example.com/docs\r\n',
    'https://user:pass@example.com/docs',
    'http://user@example.com/',
    'https://example.com/\u0000',
    'not a url at all',
    'https://',
    42 as unknown as string,
    null as unknown as string,
    undefined as unknown as string,
  ];
  it.each(rejected)('rejects %p', (url) => {
    expect(isSafeHttpUrl(url)).toBe(false);
  });
});
