import { domainOf, isInternalUrl, matchWhitelist, parseRule } from '../../src/lib/core/domain';

describe('parseRule', () => {
  it.each([
    ['GitHub.com', 'github.com'],
    ['https://mail.google.com/mail/u/0/#inbox', 'mail.google.com'],
    ['localhost', 'localhost'],
    ['localhost:3000', 'localhost:3000'],
    ['*.example.com', '*.example.com'],
    ['example.com.', 'example.com'],
    ['user:pw@host.dev/path', 'host.dev'],
  ])('normalizes %s → %s', (input, out) => {
    const r = parseRule(input);
    expect(r.ok && r.normalized).toBe(out);
  });

  it.each(['', '   ', 'exa mple.com', 'foo*.com', '-bad.com', 'a..b', 'host:99999'])(
    'rejects %j',
    (input) => {
      expect(parseRule(input).ok).toBe(false);
    },
  );
});

describe('matchWhitelist', () => {
  const rules = ['example.com', 'meet.google.com', 'localhost', '*.corp.dev', 'app.test:8080'];

  it('matches the exact host and subdomains', () => {
    expect(matchWhitelist('https://example.com/x', rules)).toBe('example.com');
    expect(matchWhitelist('https://www.example.com/', rules)).toBe('example.com');
    expect(matchWhitelist('https://a.b.example.com/', rules)).toBe('example.com');
  });

  it('never matches look-alike domains (no substring matching)', () => {
    expect(matchWhitelist('https://fakeexample.com/', rules)).toBeNull();
    expect(matchWhitelist('https://example.com.evil.net/', rules)).toBeNull();
    expect(matchWhitelist('https://notmeet.google.com/', rules)).toBeNull();
    expect(matchWhitelist('https://google.com/', rules)).toBeNull();
  });

  it('matches localhost on any port when no port is given', () => {
    expect(matchWhitelist('http://localhost:5173/', rules)).toBe('localhost');
    expect(matchWhitelist('http://localhost/', rules)).toBe('localhost');
  });

  it('supports subdomain-only wildcards', () => {
    expect(matchWhitelist('https://wiki.corp.dev/', rules)).toBe('*.corp.dev');
    expect(matchWhitelist('https://corp.dev/', rules)).toBeNull();
  });

  it('respects explicit ports', () => {
    expect(matchWhitelist('http://app.test:8080/', rules)).toBe('app.test:8080');
    expect(matchWhitelist('http://app.test:9090/', rules)).toBeNull();
    expect(matchWhitelist('http://app.test/', rules)).toBeNull();
  });

  it('is case-insensitive and ignores invalid inputs', () => {
    expect(matchWhitelist('https://WWW.EXAMPLE.COM/', rules)).toBe('example.com');
    expect(matchWhitelist('not a url', rules)).toBeNull();
    expect(matchWhitelist('file:///home/x.html', rules)).toBeNull();
  });
});

describe('internal pages', () => {
  it.each([
    'chrome://settings',
    'edge://newtab',
    'brave://rewards',
    'about:preferences',
    'moz-extension://x/p.html',
    'chrome-extension://x/p.html',
    'view-source:https://a.com',
    '',
  ])('%s is internal', (u) => expect(isInternalUrl(u)).toBe(true));
  it.each(['https://a.com', 'http://localhost:3000', 'file:///tmp/a.html'])(
    '%s is a normal page',
    (u) => expect(isInternalUrl(u)).toBe(false),
  );
  it('domainOf', () => {
    expect(domainOf('https://docs.example.com/a')).toBe('docs.example.com');
    expect(domainOf('chrome://settings')).toBe('settings');
    expect(domainOf('garbage')).toBe('');
  });
});
