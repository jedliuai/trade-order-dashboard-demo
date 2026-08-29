import { DEMO_PACKAGING_BOX_ARTWORK_ALERT_TYPE } from './boxArtworkReminder.ts';

export interface AlertWorkspaceRow {
  id: string;
  alert_type: string;
  related_type: string;
  related_id: string;
  priority: 'high' | 'medium' | 'low';
  message: string;
  status: string;
  created_at: string;
}

export interface AlertWorkspaceFilters {
  status: string;
  query?: string;
  priority?: string;
  relatedType?: string;
  alertType?: string;
}

const priorityOrder = { high: 0, medium: 1, low: 2 } as const;

function alertTypeOrder(alertType: string): number {
  return alertType === DEMO_PACKAGING_BOX_ARTWORK_ALERT_TYPE ? 0 : 1;
}

export function getAlertNavigationTab(relatedType: string): string {
  if (relatedType === 'contract') return 'contracts';
  if (relatedType === 'contact_sheet') return 'contact_sheets';
  if (relatedType === 'batch') return 'batches';
  if (relatedType === 'shipment' || relatedType === 'invoice') return 'shipments';
  if (relatedType === 'payment') return 'payments';
  return 'alerts';
}

export function filterAlertWorkspace<T extends AlertWorkspaceRow>(
  alerts: T[],
  filters: AlertWorkspaceFilters,
  getExtraSearchText: (alert: T) => string = () => ''
): T[] {
  const query = (filters.query || '').trim().toLocaleLowerCase();
  return alerts.filter((alert) => {
    if (alert.status !== filters.status) return false;
    if (filters.priority && alert.priority !== filters.priority) return false;
    if (filters.relatedType && alert.related_type !== filters.relatedType) return false;
    if (filters.alertType && alert.alert_type !== filters.alertType) return false;
    if (!query) return true;
    return [alert.alert_type, alert.message, alert.related_type, alert.related_id, getExtraSearchText(alert)]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });
}

export function groupAlertWorkspace<T extends AlertWorkspaceRow>(alerts: T[]) {
  const groups = new Map<string, T[]>();
  alerts.forEach((alert) => {
    const key = `${alert.alert_type}::${alert.related_type}`;
    const rows = groups.get(key) || [];
    rows.push(alert);
    groups.set(key, rows);
  });

  return Array.from(groups.entries())
    .map(([key, rows]) => ({
      key,
      alertType: rows[0].alert_type,
      relatedType: rows[0].related_type,
      priority: rows.reduce<T['priority']>((highest, row) =>
        priorityOrder[row.priority] < priorityOrder[highest] ? row.priority : highest, rows[0].priority),
      alerts: [...rows].sort((a, b) => {
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        return priorityDiff || b.created_at.localeCompare(a.created_at);
      })
    }))
    .sort((a, b) => {
      const typeDiff = alertTypeOrder(a.alertType) - alertTypeOrder(b.alertType);
      if (typeDiff) return typeDiff;
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      return priorityDiff || b.alerts[0].created_at.localeCompare(a.alerts[0].created_at);
    });
}
