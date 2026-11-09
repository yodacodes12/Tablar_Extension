import { useState } from 'react';
import { matchWhitelist, parseRule } from '../lib/core/domain';
import type { Settings } from '../lib/core/types';
import type { TabView } from '../lib/messages';
import { LockIcon, XIcon } from './icons';
import { useSettingsUpdater } from './settings-panel';
import { Button, Card, Empty, IconButton } from './ui';

export function WhitelistPanel({ settings, tabs }: { settings: Settings; tabs: TabView[] }) {
  const update = useSettingsUpdater();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const add = async (text: string) => {
    const res = parseRule(text);
    if (!res.ok) return setError(res.error);
    if (settings.whitelist.includes(res.normalized))
      return setError(`${res.normalized} is already protected`);
    setSaving(true);
    const ok = await update({ whitelist: [...settings.whitelist, res.normalized] });
    setSaving(false);
    if (ok) {
      setInput('');
      setError(null);
    }
  };

  const suggestions = [
    ...new Set(tabs.filter((t) => /^https?:/.test(t.url) && !t.whitelistRule).map((t) => t.domain)),
  ].slice(0, 8);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card title="Protected websites">
        <div className="border-b border-line p-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              placeholder="e.g. mail.google.com, localhost:3000, *.example.com"
              aria-label="Domain to protect"
              aria-invalid={!!error}
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none"
            />
            <Button type="submit" variant="primary" busy={saving} disabled={!input.trim()}>
              Add
            </Button>
          </form>
          {error ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-faint">
            <code>example.com</code> covers the site and all its subdomains, but not look-alikes
            such as <code>fakeexample.com</code>. Use <code>*.example.com</code> for subdomains
            only, or add a port (<code>localhost:3000</code>) to match just that port.
          </p>
        </div>
        {settings.whitelist.length === 0 ? (
          <Empty icon={<LockIcon width={20} height={20} />} title="No protected websites yet">
            Tabs on protected websites are never suspended automatically.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {settings.whitelist.map((rule) => {
              const open = tabs.filter((t) => matchWhitelist(t.url, [rule])).length;
              return (
                <li key={rule} className="flex items-center gap-3 px-4 py-2.5">
                  <LockIcon className="text-faint" />
                  <span className="flex-1 font-mono text-[13px] text-fg">{rule}</span>
                  <span className="text-xs text-faint">
                    {open} open tab{open === 1 ? '' : 's'}
                  </span>
                  <IconButton
                    label={`Remove ${rule}`}
                    onClick={() =>
                      void update({ whitelist: settings.whitelist.filter((r) => r !== rule) })
                    }
                  >
                    <XIcon />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Quick add from open tabs">
        {suggestions.length === 0 ? (
          <Empty title="Nothing to suggest">
            Every website you have open is already protected.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {suggestions.map((d) => (
              <li key={d} className="flex items-center justify-between gap-2 px-4 py-2">
                <span className="truncate text-[13px] text-fg">{d}</span>
                <Button size="sm" onClick={() => void add(d)}>
                  Protect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
