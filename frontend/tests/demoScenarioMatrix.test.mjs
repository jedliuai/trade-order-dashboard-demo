import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { buildCustomerValueMatrix } from '../src/services/customerValueAnalytics.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3';
const source = `
import json,sys
from datetime import date
from local_api.seed import build_seed
from local_api.metrics import shipment_profits
r=build_seed(date.fromisoformat(sys.argv[1]))
print(json.dumps(dict(customers=r['customers'],contracts=r['contracts'],sheets=r['contact_sheets'],payments=r['payments'],paymentReceipts=r['payment_receipts'],shipments=r['shipments'],shipmentItems=r['shipment_items'],shipmentProfits=shipment_profits(r),exchangeRates=r['exchange_rates']),ensure_ascii=True))
`;

for (const day of ['2026-10-28', '2026-01-01', '2024-02-29']) {
  test(`虚构订单计算出每个业务员十二家客户、四象限各三家：${day}`, () => {
    const generated = spawnSync(python, ['-c', source, day], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true });
    assert.equal(generated.status, 0, generated.stderr);
    const snapshot = JSON.parse(generated.stdout);
    assert.equal(snapshot.customers.length, 48);
    const year = Number(day.slice(0, 4)) - (day.slice(5, 7) === '12' ? 0 : 1);
    const ranges = [
      { startDate: `${year}-12-01`, endDate: day },
      { startDate: `${day.slice(0, 7)}-01`, endDate: day },
    ];
    for (const owner of ['demo-sales-1', 'demo-sales-2', 'demo-sales-3', 'demo-sales-4']) {
      const input = Object.fromEntries(Object.entries(snapshot).map(([key, rows]) => [key, rows.filter(row => row.owner_id === owner || row.owner_id === 'demo-shared')]));
      for (const range of ranges) {
        const result = buildCustomerValueMatrix(input, range);
        assert.equal(result.activeCustomerCount, 12);
        for (const quadrant of ['core', 'potential', 'scale', 'low']) {
          assert.equal(result.rows.filter(row => row.quadrant === quadrant).length, 3, `${owner} ${range.startDate} ${quadrant}`);
        }
        assert.equal(new Set(result.rows.map(row => row.customerName.slice(0, 8))).size, 12);
        assert.equal(result.missingRateCount, 0);
      }
    }
    for (const regionOwners of [['demo-sales-1', 'demo-sales-2'], ['demo-sales-3', 'demo-sales-4']]) {
      const region = Object.fromEntries(Object.entries(snapshot).map(([key, rows]) => [key, rows.filter(row => regionOwners.includes(row.owner_id) || row.owner_id === 'demo-shared')]));
      for (const range of ranges) {
        const result = buildCustomerValueMatrix(region, range);
        assert.equal(result.activeCustomerCount, 24);
        for (const quadrant of ['core', 'potential', 'scale', 'low']) {
          assert.equal(result.rows.filter(row => row.quadrant === quadrant).length, 6);
        }
      }
    }
    for (const range of ranges) {
      const combined = buildCustomerValueMatrix(snapshot, range);
      assert.equal(combined.activeCustomerCount, 48);
      for (const quadrant of ['core', 'potential', 'scale', 'low']) {
        assert.equal(combined.rows.filter(row => row.quadrant === quadrant).length, 12);
      }
    }
  });
}
