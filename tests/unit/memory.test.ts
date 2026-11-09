import {
  ChromiumProcessesProvider,
  detectProcessesApi,
  type ProcessesApi,
} from '../../src/lib/memory/chromium-processes';
import { estimateTab } from '../../src/lib/memory/estimate';
import { measurementLabel } from '../../src/lib/memory/format';
import { MemoryService } from '../../src/lib/memory/service';
import { detectSystemMemoryApi } from '../../src/lib/memory/system-memory';

const MB = 1024 * 1024;

describe('capability detection', () => {
  it('detects absent / partial / present APIs without throwing', () => {
    expect(detectProcessesApi(undefined)).toBeNull();
    expect(detectProcessesApi({})).toBeNull();
    expect(detectProcessesApi({ processes: { getProcessIdForTab: () => 1 } })).toBeNull();
    expect(
      detectProcessesApi({
        processes: { getProcessIdForTab: () => 1, getProcessInfo: () => ({}) },
      }),
    ).not.toBeNull();
    expect(detectSystemMemoryApi({ system: {} })).toBeNull();
  });

  it('Firefox-like environment: no actual providers, everything estimated, never bytes', async () => {
    const svc = MemoryService.fromBrowser({ tabs: {} });
    const caps = svc.capabilities(true);
    expect(caps.perProcess).toBe(false);
    expect(caps.system).toBe(false);
    const r = await svc.report(
      [
        { id: 1, discarded: false },
        { id: 2, discarded: true },
      ],
      true,
    );
    expect(r.system).toBeNull();
    for (const m of Object.values(r.tabs)) {
      expect(m.source).toBe('estimated');
      expect(m.valueBytes).toBeNull(); // 10. estimates never carry RAM figures
    }
    expect(r.tabs[2]!.level).toBe('low');
    expect(r.tabs[1]!.level).toBe('unknown');
  });

  it('disabled monitoring returns unavailable and touches no API', async () => {
    const getInfo = vi.fn();
    const svc = MemoryService.fromBrowser({ system: { memory: { getInfo } } });
    const r = await svc.report([{ id: 1, discarded: false }], false);
    expect(r.tabs[1]!.source).toBe('unavailable');
    expect(getInfo).not.toHaveBeenCalled();
  });

  it('9. a throwing optional API does not crash the report', async () => {
    const api: ProcessesApi = {
      getProcessIdForTab: () => Promise.reject(new Error('dev channel only')),
      getProcessInfo: () => Promise.reject(new Error('nope')),
    };
    const svc = new MemoryService(
      [new ChromiumProcessesProvider(api)],
      {
        id: 'e',
        label: 'e',
        isSupported: () => true,
        describe: () => '',
        measureTabs: async (t) => new Map(t.map((x) => [x.id, estimateTab(x, 0)])),
      },
      { getInfo: () => Promise.reject(new Error('x')) },
    );
    const r = await svc.report([{ id: 1, discarded: false }], true);
    expect(r.tabs[1]!.source).toBe('estimated');
    expect(r.system).toBeNull();
  });
});

describe('Chromium processes provider', () => {
  const api: ProcessesApi = {
    getProcessIdForTab: async (id) => (id === 3 ? 20 : 10),
    getProcessInfo: async () => ({
      '10': {
        id: 10,
        type: 'renderer',
        privateMemory: 300 * MB,
        tasks: [{ tabId: 1 }, { tabId: 2 }, {}],
      },
      '20': { id: 20, type: 'renderer', privateMemory: 120 * MB, tasks: [{ tabId: 3 }] },
    }),
  };

  it('11. shared process memory is reported at process scope, never divided or attributed as per-tab', async () => {
    const out = await new ChromiumProcessesProvider(api, () => 5).measureTabs([
      { id: 1, discarded: false },
      { id: 2, discarded: false },
      { id: 3, discarded: false },
      { id: 4, discarded: true },
    ]);
    const m1 = out.get(1)!;
    expect(m1).toMatchObject({
      source: 'actual',
      scope: 'process',
      valueBytes: 300 * MB,
      sharedByTabs: 2,
      processId: 10,
    });
    expect(out.get(2)!.valueBytes).toBe(300 * MB);
    expect(out.get(3)).toMatchObject({ scope: 'process', sharedByTabs: 1 });
    expect(out.has(4)).toBe(false); // discarded tabs have no renderer to measure
    expect(measurementLabel(m1)).toBe('300 MB process · shared ×2');
  });

  it('ignores malformed memory values', async () => {
    const bad: ProcessesApi = {
      getProcessIdForTab: async () => 1,
      getProcessInfo: async () => ({
        '1': { id: 1, type: 'renderer', privateMemory: -5, tasks: [] },
      }),
    };
    expect(
      (await new ChromiumProcessesProvider(bad).measureTabs([{ id: 1, discarded: false }])).size,
    ).toBe(0);
  });
});

describe('labels', () => {
  it('estimates are never formatted as bytes', () => {
    expect(measurementLabel(estimateTab({ id: 1, discarded: true }, 0))).toBe('Low (est.)');
    expect(measurementLabel(estimateTab({ id: 1, discarded: false }, 0))).toBe('Unknown');
    expect(measurementLabel(undefined)).toBe('Unavailable');
  });
});
