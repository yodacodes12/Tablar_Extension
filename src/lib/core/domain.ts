/**
 * Whitelist rules. A rule is a hostname (optionally with a port, or a leading "*." wildcard).
 *   "example.com"       → example.com and every subdomain (www.example.com, a.b.example.com)
 *   "*.example.com"     → subdomains only, not example.com itself
 *   "localhost:3000"    → that host on that port only
 * Matching is label-based, so "example.com" never matches "fakeexample.com".
 */
export interface DomainRule {
  host: string;
  port: string | null;
  subdomainsOnly: boolean;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/;

export type RuleParseResult =
  { ok: true; rule: DomainRule; normalized: string } | { ok: false; error: string };

export function parseRule(input: string): RuleParseResult {
  let raw = input.trim().toLowerCase();
  if (!raw) return { ok: false, error: 'Enter a domain, e.g. github.com' };

  // Be forgiving with pasted URLs: strip scheme, credentials, path, query and fragment.
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  raw = raw.replace(/^[^@/]*@/, '');
  raw = raw.split(/[/?#]/, 1)[0] ?? '';

  let subdomainsOnly = false;
  if (raw.startsWith('*.')) {
    subdomainsOnly = true;
    raw = raw.slice(2);
  }

  let host = raw;
  let port: string | null = null;
  const portMatch = /^(.*):(\d{1,5})$/.exec(raw);
  if (portMatch && !IPV6.test(raw)) {
    host = portMatch[1] ?? '';
    port = portMatch[2] ?? null;
    if (port !== null && Number(port) > 65535) return { ok: false, error: 'Port must be 0–65535' };
  }
  host = host.replace(/\.$/, '');

  if (!host) return { ok: false, error: 'Enter a domain, e.g. github.com' };
  if (host.includes('*'))
    return { ok: false, error: 'Wildcards are only allowed as a leading "*."' };
  if (!IPV6.test(host)) {
    const labels = host.split('.');
    if (!labels.every((l) => LABEL.test(l)))
      return { ok: false, error: `"${input.trim()}" is not a valid domain` };
  }

  const normalized = `${subdomainsOnly ? '*.' : ''}${host}${port ? `:${port}` : ''}`;
  return { ok: true, rule: { host, port, subdomainsOnly }, normalized };
}

export function hostMatchesRule(hostname: string, port: string, rule: DomainRule): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (rule.port !== null && rule.port !== port) return false;
  if (host === rule.host) return !rule.subdomainsOnly;
  return host.endsWith(`.${rule.host}`);
}

/** Returns the first rule (normalized string) matching the URL, or null. */
export function matchWhitelist(url: string, rules: readonly string[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.hostname) return null;
  const port = parsed.port || defaultPort(parsed.protocol);
  for (const text of rules) {
    const res = parseRule(text);
    if (res.ok && hostMatchesRule(parsed.hostname, port, res.rule)) return res.normalized;
  }
  return null;
}

function defaultPort(protocol: string): string {
  if (protocol === 'http:') return '80';
  if (protocol === 'https:') return '443';
  return '';
}

export function domainOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname) return u.hostname;
    return u.protocol.replace(/:$/, '');
  } catch {
    return '';
  }
}

const DISCARDABLE_SCHEMES = new Set(['http:', 'https:', 'file:']);

/** Browser-internal and extension pages are never touched. */
export function isInternalUrl(url: string): boolean {
  try {
    return !DISCARDABLE_SCHEMES.has(new URL(url).protocol);
  } catch {
    return true;
  }
}
