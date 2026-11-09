import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  THRESHOLD_PRESETS,
  MAX_THRESHOLD_MINUTES,
  MIN_THRESHOLD_MINUTES,
  validateThreshold,
} from '../lib/core/inactivity';
import { HISTORY_RETENTION_OPTIONS } from '../lib/core/settings';
import type { Settings } from '../lib/core/types';
import { call } from '../lib/ui/client';
import { useActions } from './actions';
import { Card, Segmented, Toggle } from './ui';

export function useSettingsUpdater() {
  const { toast } = useActions();
  return async (patch: Partial<Settings>): Promise<boolean> => {
    try {
      const res = await call({ type: 'updateSettings', patch });
      if (!res.ok) {
        toast({ tone: 'error', text: res.error });
        return false;
      }
      return true;
    } catch (e) {
      toast({ tone: 'error', text: e instanceof Error ? e.message : 'Could not save settings' });
      return false;
    }
  };
}

export function ThresholdPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const isPreset = (THRESHOLD_PRESETS as readonly number[]).includes(value);
  const [custom, setCustom] = useState(isPreset ? '' : String(value));
  const [showCustom, setShowCustom] = useState(!isPreset);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!(THRESHOLD_PRESETS as readonly number[]).includes(value)) {
      setShowCustom(true);
      setCustom(String(value));
    }
  }, [value]);

  return (
    <div className="py-3">
      <div className="text-sm font-medium text-fg">Suspend tabs after</div>
      <p className="mt-0.5 text-xs text-faint">
        Time since you last used a tab. Checked every minute.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {THRESHOLD_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={!showCustom && value === m}
            onClick={() => {
              setShowCustom(false);
              setErr(null);
              onChange(m);
            }}
            className={`h-8 rounded-lg border px-3 text-xs font-medium tabular-nums ${!showCustom && value === m ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-fg'}`}
          >
            {m} min
          </button>
        ))}
        <button
          type="button"
          aria-pressed={showCustom}
          onClick={() => setShowCustom(true)}
          className={`h-8 rounded-lg border px-3 text-xs font-medium ${showCustom ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-fg'}`}
        >
          Custom
        </button>
      </div>
      {showCustom ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = validateThreshold(custom);
            if (!v.ok) return setErr(v.error);
            setErr(null);
            onChange(v.value);
          }}
        >
          <input
            type="number"
            inputMode="numeric"
            min={MIN_THRESHOLD_MINUTES}
            max={MAX_THRESHOLD_MINUTES}
            value={custom}
            aria-label="Custom minutes"
            aria-invalid={!!err}
            onChange={(e) => setCustom(e.target.value)}
            className="h-8 w-24 rounded-lg border border-line bg-raised px-2 text-sm tabular-nums text-fg focus:border-accent focus:outline-none"
          />
          <span className="text-xs text-muted">minutes</span>
          <button
            type="submit"
            className="h-8 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg"
          >
            Apply
          </button>
          {err ? (
            <span role="alert" className="text-xs text-danger">
              {err}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

export function SettingsPanel({
  settings,
  browserFamily,
}: {
  settings: Settings;
  browserFamily: 'firefox' | 'chromium';
}) {
  const update = useSettingsUpdater();
  const { toast } = useActions();

  const setNotifications = async (on: boolean) => {
    if (on) {
      // Must be requested from the click handler (user gesture).
      let granted = false;
      try {
        granted = await browser.permissions.request({ permissions: ['notifications'] });
      } catch (e) {
        toast({
          tone: 'error',
          text: e instanceof Error ? e.message : 'Permission request failed',
        });
      }
      if (!granted) {
        toast({ tone: 'error', text: 'Notification permission was not granted.' });
        return;
      }
    } else {
      await browser.permissions.remove({ permissions: ['notifications'] }).catch(() => undefined);
    }
    await update({ notifications: on });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Automatic suspension">
        <div className="divide-y divide-line px-4">
          <Toggle
            label="Suspend inactive tabs automatically"
            description="Manual suspend and restore always work, even when this is off."
            checked={settings.autoSuspend}
            onChange={(v) => void update({ autoSuspend: v })}
          />
          <ThresholdPicker
            value={settings.thresholdMinutes}
            onChange={(v) => void update({ thresholdMinutes: v })}
          />
        </div>
      </Card>

      <Card title="Protection">
        <div className="divide-y divide-line px-4">
          <Toggle
            label="Protect pinned tabs"
            checked={settings.protectPinned}
            onChange={(v) => void update({ protectPinned: v })}
          />
          <Toggle
            label="Protect tabs playing audio"
            checked={settings.protectAudible}
            onChange={(v) => void update({ protectAudible: v })}
          />
          <Toggle
            label="Protect tabs using camera, microphone or screen sharing"
            description={
              browserFamily === 'firefox'
                ? 'Detected from Firefox’s tab sharing state.'
                : 'Chromium does not expose this to extensions; tabs in a call usually also play audio, which is protected above.'
            }
            checked={settings.protectMediaCapture}
            onChange={(v) => void update({ protectMediaCapture: v })}
          />
          <div className="py-3">
            <div className="text-sm font-medium text-fg">Private windows</div>
            <p className="mt-0.5 mb-2 text-xs text-faint">
              Only applies if you allowed Tablar in private windows. Private tabs are never written
              to history.
            </p>
            <Segmented
              label="Private window behaviour"
              value={settings.incognito}
              onChange={(v) => void update({ incognito: v })}
              options={[
                { value: 'protect', label: 'Never auto-suspend' },
                { value: 'allow', label: 'Treat like normal tabs' },
              ]}
            />
          </div>
          <p className="py-3 text-xs text-faint">
            The active tab is always protected. Browser pages (settings, new tab, extensions) cannot
            be suspended.
          </p>
        </div>
      </Card>

      <Card title="Memory & notifications">
        <div className="divide-y divide-line px-4">
          <Toggle
            label="Memory monitoring"
            description="Reads memory information only while a Tablar page is open. Never polls in the background."
            checked={settings.memoryMonitoring}
            onChange={(v) => void update({ memoryMonitoring: v })}
          />
          <Toggle
            label="Notify when tabs are auto-suspended"
            description="One summary notification per check. Asks for the notifications permission."
            checked={settings.notifications}
            onChange={(v) => void setNotifications(v)}
          />
        </div>
      </Card>

      <Card title="Appearance & history">
        <div className="divide-y divide-line px-4">
          <div className="flex items-center justify-between gap-3 py-3">
            <span className="text-sm font-medium text-fg">Theme</span>
            <Segmented
              label="Theme"
              value={settings.theme}
              onChange={(v) => void update({ theme: v })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <span className="text-sm font-medium text-fg">Keep history for</span>
              <p className="mt-0.5 text-xs text-faint">Older events are deleted automatically.</p>
            </div>
            <select
              aria-label="History retention"
              value={settings.historyRetentionDays}
              onChange={(e) => void update({ historyRetentionDays: Number(e.target.value) })}
              className="h-8 rounded-lg border border-line bg-raised px-2 text-sm text-fg"
            >
              {[...new Set([...HISTORY_RETENTION_OPTIONS, settings.historyRetentionDays])]
                .sort((a, b) => a - b)
                .map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? '1 day' : `${d} days`}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </Card>
    </div>
  );
}
