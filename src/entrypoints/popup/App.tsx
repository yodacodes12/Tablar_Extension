import { ActionsProvider, useActions } from '../../components/actions';
import { GearIcon, LayoutIcon, PauseIcon, PlayIcon } from '../../components/icons';
import { SystemMemoryBar } from '../../components/memory-panel';
import { MonitoringStatus } from '../../components/status';
import { TabList } from '../../components/tab-list';
import { Button, ErrorBanner, IconButton, Logo, Spinner, Stat } from '../../components/ui';
import type { Snapshot } from '../../lib/messages';
import { useMemory, useSnapshot, useTheme } from '../../lib/ui/hooks';
import { openDashboard } from '../../lib/ui/navigation';

export function PopupApp() {
  const { snapshot, error, refresh } = useSnapshot();
  useTheme(snapshot?.settings.theme);
  return (
    <ActionsProvider onDone={refresh}>
      <div className="flex w-[400px] flex-col bg-bg text-fg">
        <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5">
          <Logo />
          {snapshot ? <MonitoringStatus snapshot={snapshot} /> : null}
          <div className="ml-auto flex">
            <IconButton
              label="Settings"
              onClick={() => void openDashboard('settings').then(() => window.close())}
            >
              <GearIcon />
            </IconButton>
            <IconButton
              label="Open dashboard"
              onClick={() => void openDashboard().then(() => window.close())}
            >
              <LayoutIcon />
            </IconButton>
          </div>
        </header>
        {error ? (
          <div className="p-3">
            <ErrorBanner message={error} onRetry={() => void refresh()} />
          </div>
        ) : !snapshot ? (
          <div className="flex h-64 items-center justify-center text-faint">
            <Spinner />
          </div>
        ) : (
          <PopupBody snapshot={snapshot} />
        )}
      </div>
    </ActionsProvider>
  );
}

function PopupBody({ snapshot }: { snapshot: Snapshot }) {
  const { report } = useMemory(snapshot);
  const { bulk, bulkBusy } = useActions();
  const c = snapshot.counts;
  return (
    <>
      <div className="grid grid-cols-4 gap-2 px-3 pt-3">
        <Stat label="Tabs" value={c.total} />
        <Stat label="Active" value={c.active} />
        <Stat label="Eligible" value={c.eligible} tone={c.eligible ? 'warn' : undefined} />
        <Stat label="Suspended" value={c.suspended} tone={c.suspended ? 'accent' : undefined} />
      </div>
      <div className="mx-3 mt-3 rounded-xl border border-line bg-surface px-3 py-2.5">
        <SystemMemoryBar report={report} compact />
      </div>
      <div className="flex gap-2 px-3 pt-3">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          busy={bulkBusy === 'suspendIdle'}
          disabled={c.eligible === 0 || !!bulkBusy}
          title={`Suspend tabs idle for ${snapshot.settings.thresholdMinutes}+ minutes that are not protected`}
          onClick={() => void bulk('suspendIdle')}
        >
          <PauseIcon width={12} height={12} /> Suspend idle{c.eligible ? ` (${c.eligible})` : ''}
        </Button>
        <Button
          size="sm"
          className="flex-1"
          busy={bulkBusy === 'suspendAllInactive'}
          disabled={!snapshot.tabs.some((t) => t.manualAllowed) || !!bulkBusy}
          title="Suspend every unprotected tab except the ones you are looking at"
          onClick={() => void bulk('suspendAllInactive')}
        >
          Suspend all others
        </Button>
        <Button
          size="sm"
          busy={bulkBusy === 'restoreAll'}
          disabled={c.suspended === 0 || !!bulkBusy}
          onClick={() => void bulk('restoreAll')}
          title="Reload every suspended tab"
        >
          <PlayIcon width={12} height={12} /> Restore all
        </Button>
      </div>
      <div className="mx-3 my-3 overflow-hidden rounded-xl border border-line bg-surface">
        <TabList tabs={snapshot.tabs} now={snapshot.now} compact maxHeight="280px" />
      </div>
    </>
  );
}
