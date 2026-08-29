export interface BatchWorkspaceRow {
  id: string;
  contactSheetId: string;
  phase: 'pending_warehouse' | 'pending_release' | 'released';
  severity: number;
  batchQuantity: number;
  warehouseDate: string;
  releaseDate: string;
  sheetWarehouseDate: string;
  sheetReleaseDate: string;
}

export interface BatchWorkspaceSummary {
  contactSheetId: string;
  batchIds: string[];
  batchCount: number;
  totalQuantity: number;
  maxSeverity: number;
  phases: BatchWorkspaceRow['phase'][];
  allReleased: boolean;
  hasPhaseDivergence: boolean;
  hasSheetDateMismatch: boolean;
  needsAttention: boolean;
}

export function summarizeBatchWorkspace(rows: BatchWorkspaceRow[]): BatchWorkspaceSummary[] {
  const grouped = new Map<string, BatchWorkspaceRow[]>();
  rows.forEach((row) => {
    const list = grouped.get(row.contactSheetId) || [];
    list.push(row);
    grouped.set(row.contactSheetId, list);
  });

  return Array.from(grouped.entries()).map(([contactSheetId, batches]) => {
    const phases = Array.from(new Set(batches.map((batch) => batch.phase)));
    const hasPhaseDivergence = phases.length > 1;
    const hasSheetDateMismatch = batches.some((batch) => (
      batch.warehouseDate !== batch.sheetWarehouseDate
      || batch.releaseDate !== batch.sheetReleaseDate
    ));
    const maxSeverity = Math.max(0, ...batches.map((batch) => batch.severity));
    const allReleased = batches.every((batch) => batch.phase === 'released');
    return {
      contactSheetId,
      batchIds: batches.map((batch) => batch.id),
      batchCount: batches.length,
      totalQuantity: batches.reduce((sum, batch) => sum + batch.batchQuantity, 0),
      maxSeverity,
      phases,
      allReleased,
      hasPhaseDivergence,
      hasSheetDateMismatch,
      needsAttention: maxSeverity >= 2 || hasPhaseDivergence || hasSheetDateMismatch
    };
  });
}
