import type {
  CustomerValueAnalyticsInput,
  DateRange
} from './customerValueAnalytics';
import { CUSTOMER_DORMANCY_DAYS } from './customerOperatingConfig.ts';

export type CustomerActivityStatus = 'new' | 'active' | 'dormant' | 'reactivated';

export interface CustomerActivityRow {
  customerId: string;
  customerName: string;
  firstShipmentDate: string;
  latestShipmentDate: string;
  physicalShipmentCount: number;
  averageRepurchaseIntervalDays: number | null;
  status: CustomerActivityStatus;
}

export interface CustomerActivityResult {
  rows: CustomerActivityRow[];
  counts: Record<CustomerActivityStatus, number>;
  dormancyDays: number;
  asOfDate: string;
}

interface PhysicalShipmentEvent {
  customerId: string;
  customerName: string;
  shipmentDate: string;
  hasDirectCustomerId: boolean;
}

const clean = (value: unknown) => String(value ?? '').trim();
const dateOnly = (value: unknown) => clean(value).slice(0, 10);

function dayDiff(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / 86_400_000);
}

function averageDistinctDateInterval(dates: string[]) {
  const distinctDates = [...new Set(dates)].sort();
  if (distinctDates.length < 2) return null;

  let totalDays = 0;
  let intervalCount = 0;
  for (let index = 1; index < distinctDates.length; index += 1) {
    const interval = dayDiff(distinctDates[index - 1], distinctDates[index]);
    if (interval === null) continue;
    totalDays += interval;
    intervalCount += 1;
  }
  return intervalCount ? totalDays / intervalCount : null;
}

function resolveStatus(
  distinctDates: string[],
  range: DateRange
): CustomerActivityStatus {
  const firstShipmentDate = distinctDates[0];
  const latestShipmentDate = distinctDates[distinctDates.length - 1];
  if (firstShipmentDate >= range.startDate && firstShipmentDate <= range.endDate) {
    return 'new';
  }

  for (let index = 1; index < distinctDates.length; index += 1) {
    const shipmentDate = distinctDates[index];
    if (shipmentDate < range.startDate || shipmentDate > range.endDate) continue;
    const interval = dayDiff(distinctDates[index - 1], shipmentDate);
    if (interval !== null && interval >= CUSTOMER_DORMANCY_DAYS) {
      return 'reactivated';
    }
  }

  const daysSinceLatestShipment = dayDiff(latestShipmentDate, range.endDate);
  if (daysSinceLatestShipment !== null && daysSinceLatestShipment >= CUSTOMER_DORMANCY_DAYS) {
    return 'dormant';
  }
  return 'active';
}

export function buildCustomerActivity(
  input: CustomerValueAnalyticsInput,
  range: DateRange
): CustomerActivityResult {
  const customerById = new Map(input.customers.map((customer) => [customer.id, customer]));
  const contractById = new Map(input.contracts.map((contract) => [contract.id, contract]));
  const physicalEventByKey = new Map<string, PhysicalShipmentEvent>();

  for (const shipment of input.shipments) {
    const shipmentDate = dateOnly(shipment.shipment_date);
    if (shipment.status !== '已发货' || !shipmentDate || shipmentDate > range.endDate) continue;

    const contract = contractById.get(shipment.contract_id);
    const customerId = clean(shipment.customer_id) || clean(contract?.customer_id);
    if (!customerId) continue;

    // 数据模型保证同一发货组属于同一客户；加 customerId 前缀可避免脏数据
    // 或测试夹具中的跨客户 group id 冲突导致事件被错误吞并。
    const physicalKey = clean(shipment.shipment_group_id) || shipment.id;
    const key = `${customerId}:${physicalKey}`;
    const customerName = customerById.get(customerId)?.name
      || shipment.customer_name
      || contract?.customer_name
      || '未命名客户';
    const nextEvent: PhysicalShipmentEvent = {
      customerId,
      customerName,
      shipmentDate,
      hasDirectCustomerId: Boolean(clean(shipment.customer_id))
    };
    const existingEvent = physicalEventByKey.get(key);
    if (!existingEvent) {
      physicalEventByKey.set(key, nextEvent);
      continue;
    }

    if (!existingEvent.hasDirectCustomerId && nextEvent.hasDirectCustomerId) {
      existingEvent.customerId = nextEvent.customerId;
      existingEvent.customerName = nextEvent.customerName;
      existingEvent.hasDirectCustomerId = true;
    }
    if (nextEvent.shipmentDate < existingEvent.shipmentDate) {
      existingEvent.shipmentDate = nextEvent.shipmentDate;
    }
  }

  const eventsByCustomer = new Map<string, PhysicalShipmentEvent[]>();
  for (const event of physicalEventByKey.values()) {
    const events = eventsByCustomer.get(event.customerId) || [];
    events.push(event);
    eventsByCustomer.set(event.customerId, events);
  }

  const rows: CustomerActivityRow[] = [];
  const counts: Record<CustomerActivityStatus, number> = {
    new: 0,
    active: 0,
    dormant: 0,
    reactivated: 0
  };
  for (const [customerId, events] of eventsByCustomer) {
    events.sort((left, right) => left.shipmentDate.localeCompare(right.shipmentDate));
    const distinctDates = [...new Set(events.map((event) => event.shipmentDate))].sort();
    const status = resolveStatus(distinctDates, range);
    counts[status] += 1;
    rows.push({
      customerId,
      customerName: customerById.get(customerId)?.name || events[0].customerName,
      firstShipmentDate: distinctDates[0],
      latestShipmentDate: distinctDates[distinctDates.length - 1],
      physicalShipmentCount: events.length,
      averageRepurchaseIntervalDays: averageDistinctDateInterval(distinctDates),
      status
    });
  }

  rows.sort((left, right) => (
    right.latestShipmentDate.localeCompare(left.latestShipmentDate)
    || left.customerName.localeCompare(right.customerName, 'zh-CN')
    || left.customerId.localeCompare(right.customerId)
  ));

  return {
    rows,
    counts,
    dormancyDays: CUSTOMER_DORMANCY_DAYS,
    asOfDate: range.endDate
  };
}
