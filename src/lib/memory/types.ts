/**
 * Memory measurements are always tagged with where they came from and what they cover.
 * A process- or system-scoped number is NEVER presented as a per-tab number.
 */
export type MeasurementSource = 'actual' | 'estimated' | 'unavailable';
export type MeasurementScope = 'tab' | 'process' | 'browser' | 'system' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low' | 'none';
export type ResourceLevel = 'low' | 'moderate' | 'high' | 'unknown';

export interface MemoryMeasurement {
  /** Bytes, only for `source: "actual"`. Always null for estimates. */
  valueBytes: number | null;
  source: MeasurementSource;
  scope: MeasurementScope;
  confidence: Confidence;
  measuredAt: number | null;
  /** Qualitative level, only for estimates. */
  level?: ResourceLevel;
  /** For process scope: how many tabs share the measured process (value is NOT divided). */
  sharedByTabs?: number;
  processId?: number;
  /** Human-readable explanation of the basis of this value. */
  basis: string;
}

export interface MemoryCapabilities {
  enabled: boolean;
  perTab: boolean;
  perProcess: boolean;
  system: boolean;
  providers: { id: string; label: string; available: boolean; detail: string }[];
}

export interface SystemMemory {
  capacityBytes: number;
  availableBytes: number;
  measuredAt: number;
}

export interface TabMemoryInput {
  id: number;
  discarded: boolean;
  status?: string;
}

export interface MemoryProvider {
  readonly id: string;
  readonly label: string;
  isSupported(): boolean;
  describe(): string;
  /** Measurements for many tabs at once — providers batch internally to stay cheap. */
  measureTabs(tabs: readonly TabMemoryInput[]): Promise<Map<number, MemoryMeasurement>>;
}

export const UNAVAILABLE = (basis: string): MemoryMeasurement => ({
  valueBytes: null,
  source: 'unavailable',
  scope: 'unknown',
  confidence: 'none',
  measuredAt: null,
  basis,
});
