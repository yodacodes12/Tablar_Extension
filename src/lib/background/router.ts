import { browser } from 'wxt/browser';
import type { Envelope, Request, ResponseMap } from '../messages';
import type { MemoryService } from '../memory/service';
import type { Engine } from './engine';

export function createRouter(
  engine: Engine,
  memory: MemoryService,
  ready: Promise<void>,
  e2e: boolean,
) {
  return async function handle(req: Request): Promise<Envelope<ResponseMap[Request['type']]>> {
    try {
      await ready;
      return { ok: true, data: await dispatch(req) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error' };
    }
  };

  async function dispatch(req: Request): Promise<ResponseMap[Request['type']]> {
    switch (req.type) {
      case 'getSnapshot':
        return engine.snapshot();
      case 'getMemory': {
        const snap = await engine.snapshot();
        return memory.report(
          snap.tabs.map((t) => ({ id: t.id, discarded: t.discarded })),
          snap.settings.memoryMonitoring,
        );
      }
      case 'suspend':
        assertIds(req.tabIds);
        return engine.suspend(req.tabIds, {
          method: req.method === 'manual-bulk' ? 'manual-bulk' : 'manual-single',
          force: req.force === true,
        });
      case 'suspendIdle':
        return engine.suspendIdle();
      case 'suspendAllInactive':
        return engine.suspendAllInactive();
      case 'restore':
        assertIds(req.tabIds);
        return engine.restore(req.tabIds);
      case 'restoreAll':
        return engine.restoreAll();
      case 'activate':
        assertIds([req.tabId]);
        await engine.activate(req.tabId);
        return { ok: true };
      case 'updateSettings':
        if (!req.patch || typeof req.patch !== 'object') throw new Error('Invalid settings');
        return engine.updateSettings(req.patch);
      case 'getHistory':
        return engine.history();
      case 'clearHistory':
        await engine.clearHistory();
        return { ok: true };
      case 'debug:setLastActive':
        if (!e2e) throw new Error('Not available');
        return { ok: await engine.debugSetLastActive(req.tabId, req.at) };
      case 'debug:evaluate':
        if (!e2e) throw new Error('Not available');
        return engine.evaluate({ ignoreGap: true });
      case 'debug:browser':
        if (!e2e) throw new Error('Not available');
        return debugBrowser(req);
      default:
        throw new Error('Unknown request');
    }
  }
}

/** E2E builds only: lets the Firefox suite inspect real browser state from a web page. */
async function debugBrowser(req: Extract<Request, { type: 'debug:browser' }>): Promise<unknown> {
  switch (req.op) {
    case 'create': {
      const t = await browser.tabs.create({
        url: req.props.url,
        active: req.props.active ?? false,
        pinned: req.props.pinned ?? false,
      });
      for (let i = 0; i < 100; i++) {
        const cur = await browser.tabs.get(t.id!);
        if (cur.status === 'complete' && cur.url?.startsWith('http')) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      return t.id;
    }
    case 'get':
      return browser.tabs.get(req.tabId);
    case 'activeTab':
      return (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
    case 'alarm':
      return (await browser.alarms.get('tablar:evaluate')) ?? null;
    case 'settingsStored':
      return (await browser.storage.local.get('tablar:settings'))['tablar:settings'];
  }
}

function assertIds(ids: unknown): asserts ids is number[] {
  if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n) && n >= 0))
    throw new Error('Invalid tab id');
}
