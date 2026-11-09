import type { SystemMemory } from './types';

/** chrome.system.memory (Chromium, "system.memory" permission). Firefox has no equivalent. */
export interface SystemMemoryApi {
  getInfo(): Promise<{ capacity: number; availableCapacity: number }>;
}

export function detectSystemMemoryApi(root: unknown): SystemMemoryApi | null {
  const api = (root as { system?: { memory?: Partial<SystemMemoryApi> } } | undefined)?.system
    ?.memory;
  return api && typeof api.getInfo === 'function' ? (api as SystemMemoryApi) : null;
}

export async function readSystemMemory(
  api: SystemMemoryApi | null,
  now: number,
): Promise<SystemMemory | null> {
  if (!api) return null;
  try {
    const info = await api.getInfo();
    if (
      !Number.isFinite(info.capacity) ||
      !Number.isFinite(info.availableCapacity) ||
      info.capacity <= 0 ||
      info.availableCapacity < 0
    )
      return null;
    return {
      capacityBytes: info.capacity,
      availableBytes: info.availableCapacity,
      measuredAt: now,
    };
  } catch {
    return null;
  }
}
