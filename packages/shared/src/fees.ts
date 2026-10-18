import type { DataSource, FeeStatus, FeeType } from './enums.js';
import { sumMinor } from './money.js';

export interface FeeLine {
  type: FeeType;
  label: string;
  amountMinor: number | null;
  status: FeeStatus;
  source: DataSource;
}

export interface FeeSummary {
  confirmedTotalMinor: number;
  estimatedTotalMinor: number;
  hasUnconfirmed: boolean;
  hasEstimates: boolean;
  lines: FeeLine[];
}

/**
 * Summarise fee lines. Confirmed lines make up the confirmed total; estimated lines are
 * reported separately and never folded into the confirmed total. NOT_CONFIRMED lines have
 * no amount and flag the order as having pending costs ("Not yet confirmed").
 */
export function summarizeFees(lines: FeeLine[]): FeeSummary {
  for (const l of lines) {
    if (l.status === 'NOT_CONFIRMED' && l.amountMinor !== null) throw new Error(`Unconfirmed fee "${l.label}" must not carry an amount`);
    if (l.status !== 'NOT_CONFIRMED' && (l.amountMinor === null || !Number.isInteger(l.amountMinor) || l.amountMinor < 0)) {
      throw new Error(`Fee "${l.label}" needs a non-negative integer amount`);
    }
    if (l.status === 'CONFIRMED' && l.source === 'SYSTEM_ESTIMATE') throw new Error(`System estimate "${l.label}" cannot be marked confirmed`);
  }
  const confirmed = lines.filter((l) => l.status === 'CONFIRMED').map((l) => l.amountMinor as number);
  const estimated = lines.filter((l) => l.status === 'ESTIMATED').map((l) => l.amountMinor as number);
  return {
    confirmedTotalMinor: sumMinor(confirmed),
    estimatedTotalMinor: sumMinor(estimated),
    hasUnconfirmed: lines.some((l) => l.status === 'NOT_CONFIRMED'),
    hasEstimates: estimated.length > 0,
    lines,
  };
}
