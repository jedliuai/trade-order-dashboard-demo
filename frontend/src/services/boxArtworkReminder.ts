import { addDaysToLocalDate, formatLocalDate } from './dateUtils.ts';

export const DEMO_PACKAGING_CUSTOMER_NAME = 'DEMO PACKAGING PARTNER';
export const DEMO_PACKAGING_BOX_ARTWORK_ALERT_TYPE = '请确认 DEMO_PACKAGING 盒子制版稿';
export const BOX_ARTWORK_REMINDER_LEAD_DAYS = 25;

export interface BoxArtworkReminderInput {
  customer_name?: string | null;
  business_type?: string | null;
  is_historical?: boolean | null;
  aps_scheduled_date?: string | null;
  actual_release_date?: string | null;
  box_artwork_confirmed_date?: string | null;
}

export interface BoxArtworkReminderStatus {
  applicable: boolean;
  confirmed: boolean;
  confirmedDate: string;
  reminderDate: string;
  due: boolean;
}

export function isDemoPackagingCustomer(customerName?: string | null): boolean {
  return String(customerName || '').trim().toLocaleUpperCase() === DEMO_PACKAGING_CUSTOMER_NAME;
}

export function getBoxArtworkReminderDate(apsScheduledDate?: string | null): string {
  return apsScheduledDate
    ? addDaysToLocalDate(apsScheduledDate.slice(0, 10), -BOX_ARTWORK_REMINDER_LEAD_DAYS)
    : '';
}

export function resolveBoxArtworkReminder(
  input: BoxArtworkReminderInput,
  today = formatLocalDate()
): BoxArtworkReminderStatus {
  const applicable = isDemoPackagingCustomer(input.customer_name)
    && input.business_type === '制剂'
    && !input.is_historical;
  const confirmedDate = String(input.box_artwork_confirmed_date || '').slice(0, 10);
  const reminderDate = getBoxArtworkReminderDate(input.aps_scheduled_date);
  const confirmed = Boolean(confirmedDate);
  const due = applicable
    && !confirmed
    && !input.actual_release_date
    && Boolean(reminderDate)
    && reminderDate <= today;

  return { applicable, confirmed, confirmedDate, reminderDate, due };
}
