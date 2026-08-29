import { localRest, getLocalSession } from './localClient';
import { sortCustomersForDisplay as sortCustomersForDisplayPure } from './customerOrderingSort';

const LEGACY_CUSTOMER_ORDER_STORAGE_KEY = 'trade-tracker.customer-display-order.v1';
const CUSTOMER_ORDER_STORAGE_PREFIX = 'trade-tracker.customer-display-order.v2';
export const CUSTOMER_ORDER_CHANGED_EVENT = 'trade-tracker:customer-order-changed';

interface UserUiPreferenceRow {
  customer_display_order?: unknown;
}

const loadedOrders = new Map<string, Promise<string[]>>();

function normalizeOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item))));
}

function currentOwnerId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const session = getLocalSession();
    return typeof session?.user?.id === 'string' && session.user.id ? session.user.id : null;
  } catch {
    return null;
  }
}

function storageKey(ownerId: string) {
  return `${CUSTOMER_ORDER_STORAGE_PREFIX}.${ownerId}`;
}

function publishOrder(ownerId: string, order: string[]) {
  window.localStorage.setItem(storageKey(ownerId), JSON.stringify(order));
  window.dispatchEvent(new CustomEvent(CUSTOMER_ORDER_CHANGED_EVENT));
}

export function readCustomerDisplayOrder(): string[] {
  if (typeof window === 'undefined') return [];
  const ownerId = currentOwnerId();
  if (!ownerId) return [];
  try {
    return normalizeOrder(JSON.parse(window.localStorage.getItem(storageKey(ownerId)) || '[]'));
  } catch {
    return [];
  }
}

export async function loadCustomerDisplayOrder(force = false): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  const ownerId = currentOwnerId();
  if (!ownerId) return [];
  if (!force && loadedOrders.has(ownerId)) return loadedOrders.get(ownerId)!;

  const request = (async () => {
    const rows = await localRest<UserUiPreferenceRow[]>(
      'user_ui_preferences?select=customer_display_order&limit=1'
    );
    if (rows.length > 0) {
      const order = normalizeOrder(rows[0].customer_display_order);
      publishOrder(ownerId, order);
      return order;
    }

    let legacyOrder: string[] = [];
    try {
      legacyOrder = normalizeOrder(JSON.parse(window.localStorage.getItem(LEGACY_CUSTOMER_ORDER_STORAGE_KEY) || '[]'));
    } catch {
      window.localStorage.removeItem(LEGACY_CUSTOMER_ORDER_STORAGE_KEY);
    }
    if (legacyOrder.length > 0) {
      await saveCustomerDisplayOrder(legacyOrder);
      window.localStorage.removeItem(LEGACY_CUSTOMER_ORDER_STORAGE_KEY);
      return legacyOrder;
    }

    publishOrder(ownerId, []);
    return [];
  })().catch((error) => {
    loadedOrders.delete(ownerId);
    throw error;
  });

  loadedOrders.set(ownerId, request);
  return request;
}

export async function saveCustomerDisplayOrder(customerIds: string[]): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  const ownerId = currentOwnerId();
  if (!ownerId) throw new Error('请先登录后再调整客户展示顺序。');
  const normalized = normalizeOrder(customerIds);
  await localRest<UserUiPreferenceRow[]>('user_ui_preferences?on_conflict=owner_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      owner_id: ownerId,
      customer_display_order: normalized,
      updated_at: new Date().toISOString()
    })
  });
  publishOrder(ownerId, normalized);
  loadedOrders.set(ownerId, Promise.resolve(normalized));
  return normalized;
}

export function notifyCustomerDisplayOrderContextChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CUSTOMER_ORDER_CHANGED_EVENT));
}

export function sortCustomersForDisplay<T extends { id: string; name: string }>(customers: T[], order = readCustomerDisplayOrder()): T[] {
  return sortCustomersForDisplayPure(customers, order);
}
