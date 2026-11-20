const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('cleaned ETL output reconciles to the agreed targets', () => {
  const report = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'processed', 'etl-report.json'), 'utf8'));
  assert.equal(report.cleanedRecords, 300000);
  assert.equal(report.rejectedRecords, 0);
  assert.equal(report.exactDuplicatesFound, 0);
  assert.equal(report.reconciliation.revenue, 69480952);
  assert.equal(report.reconciliation.orders, 110478);
  assert.equal(report.reconciliation.itemsSold, 434448);
  assert.equal(Number(report.reconciliation.aov.toFixed(2)), 628.91);
});
