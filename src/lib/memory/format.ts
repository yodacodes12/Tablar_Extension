import type { MemoryMeasurement } from './types';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** Short label for a measurement. Byte values only ever appear for actual measurements. */
export function measurementLabel(m: MemoryMeasurement | undefined): string {
  if (!m || m.source === 'unavailable') return 'Unavailable';
  if (m.source === 'actual' && m.valueBytes !== null) {
    const v = formatBytes(m.valueBytes);
    if (m.scope === 'process')
      return m.sharedByTabs && m.sharedByTabs > 1
        ? `${v} process · shared ×${m.sharedByTabs}`
        : `${v} process`;
    return v;
  }
  switch (m.level) {
    case 'low':
      return 'Low (est.)';
    case 'moderate':
      return 'Moderate (est.)';
    case 'high':
      return 'High (est.)';
    default:
      return 'Unknown';
  }
}
