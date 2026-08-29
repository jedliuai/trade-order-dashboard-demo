import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOX_ARTWORK_REMINDER_LEAD_DAYS,
  getBoxArtworkReminderDate,
  isDemoPackagingCustomer,
  resolveBoxArtworkReminder
} from '../src/services/boxArtworkReminder.ts';

test('DEMO_PACKAGING 盒子版式提醒日固定为 排产日前 25 天', () => {
  assert.equal(BOX_ARTWORK_REMINDER_LEAD_DAYS, 25);
  assert.equal(getBoxArtworkReminderDate('2026-08-31'), '2026-08-06');
  assert.equal(isDemoPackagingCustomer(' demo packaging partner '), true);
});

test('进入提醒窗口且尚未确认和放行时标记为到期', () => {
  const status = resolveBoxArtworkReminder({
    customer_name: 'DEMO PACKAGING PARTNER',
    business_type: '制剂',
    is_historical: false,
    aps_scheduled_date: '2026-08-31',
    actual_release_date: '',
    box_artwork_confirmed_date: ''
  }, '2026-08-06');
  assert.equal(status.applicable, true);
  assert.equal(status.reminderDate, '2026-08-06');
  assert.equal(status.due, true);
});

test('确认后或实际放行后不再重复提醒', () => {
  const base = {
    customer_name: 'DEMO PACKAGING PARTNER',
    business_type: '制剂',
    is_historical: false,
    aps_scheduled_date: '2026-08-31'
  };
  assert.equal(resolveBoxArtworkReminder({ ...base, box_artwork_confirmed_date: '2026-08-03' }, '2026-08-20').due, false);
  assert.equal(resolveBoxArtworkReminder({ ...base, actual_release_date: '2026-08-15' }, '2026-08-20').due, false);
});

test('其他客户、原料药和历史联系单不启用专属规则', () => {
  assert.equal(resolveBoxArtworkReminder({ customer_name: 'DEMO ATLAS LTD.', aps_scheduled_date: '2026-08-10' }, '2026-08-03').applicable, false);
  assert.equal(resolveBoxArtworkReminder({ customer_name: 'DEMO PACKAGING PARTNER', business_type: '原料药' }, '2026-08-03').applicable, false);
  assert.equal(resolveBoxArtworkReminder({ customer_name: 'DEMO PACKAGING PARTNER', is_historical: true }, '2026-08-03').applicable, false);
});
