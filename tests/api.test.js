const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function get(base, route) {
  const response = await fetch(`${base}${route}`);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

test('analytics APIs reconcile filters, aggregations, paging, export, and validation', { timeout: 120_000 }, async () => {
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['backend/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  let ready = false;
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`API process exited with code ${server.exitCode}`);
      try {
        const { response } = await get(base, '/health');
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(ready, true, 'API should become healthy');

    const health = await get(base, '/health');
    assert.equal(health.body.status, 'ok');

    const metadata = (await get(base, '/api/metadata')).body;
    assert.equal(metadata.records, 300000);
    assert.ok(metadata.outlets.length > 0);
    assert.ok(metadata.min_date && metadata.max_date && metadata.refresh_time);

    const all = await get(base, '/api/summary');
    assert.equal(all.body.records, 300000);
    assert.equal(all.body.orders, 110478);
    assert.equal(all.body.items_sold, 434448);
    assert.equal(all.body.revenue, 69480952);
    assert.equal(all.body.aov, all.body.revenue / all.body.orders);

    const monthly = (await get(base, '/api/monthly')).body;
    const trends = (await get(base, '/api/trends?granularity=month')).body;
    assert.ok(monthly.length > 0);
    assert.ok(trends.length > 0);
    assert.equal(Math.round(monthly.reduce((total, row) => total + row.revenue, 0)), all.body.revenue);
    assert.equal(Math.round(trends.reduce((total, row) => total + row.revenue, 0)), all.body.revenue);

    const range = await get(base, '/api/summary?start=2025-06-17&end=2026-06-16');
    assert.equal(range.body.records, all.body.records, 'inclusive date bounds include the complete workbook range');
    assert.equal(range.body.revenue, all.body.revenue);

    const outletRows = (await get(base, '/api/outlets')).body;
    const productRows = (await get(base, '/api/products?sort=quantity&direction=desc')).body;
    const categoryRows = (await get(base, '/api/categories')).body;
    const orderAnalytics = (await get(base, '/api/order-analytics')).body;
    const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key]), 0);
    assert.equal(Math.round(sum(outletRows, 'revenue')), all.body.revenue);
    assert.equal(Math.round(sum(productRows, 'revenue')), all.body.revenue);
    assert.equal(Math.round(sum(categoryRows, 'revenue')), all.body.revenue);
    assert.equal(Math.round(sum(orderAnalytics.orderTypes, 'revenue')), all.body.revenue);
    assert.equal(Math.round(sum(orderAnalytics.settlements, 'revenue')), all.body.revenue);
    assert.equal(Math.round(sum(productRows, 'quantity')), all.body.items_sold);

    const firstPage = await get(base, '/api/transactions?page=1&pageSize=2&sort=date&direction=asc');
    const secondPage = await get(base, '/api/transactions?page=2&pageSize=2&sort=date&direction=asc');
    assert.equal(firstPage.body.total, all.body.records);
    assert.equal(firstPage.body.rows.length, 2);
    assert.notDeepEqual(firstPage.body.rows, secondPage.body.rows);

    const first = firstPage.body.rows[0];
    const filterParams = new URLSearchParams({
      start: first.orderDatetime.slice(0, 10),
      end: first.orderDatetime.slice(0, 10),
      outlet: first.outlet,
      brand: first.brand,
      category: first.category,
      item: first.item,
      orderType: first.orderType,
      settlement: first.settlement
    });
    const filteredSummary = await get(base, `/api/summary?${filterParams}`);
    const filteredRows = await get(base, `/api/transactions?${filterParams}&page=1&pageSize=200`);
    assert.ok(filteredSummary.body.records > 0);
    assert.equal(filteredRows.body.total, filteredSummary.body.records);
    assert.equal(filteredRows.body.total, filteredRows.body.rows.length);
    assert.equal(Math.round(sum(filteredRows.body.rows, 'revenue')), filteredSummary.body.revenue);
    assert.equal(Math.round(sum(filteredRows.body.rows, 'quantity')), filteredSummary.body.items_sold);
    assert.ok(filteredSummary.body.orders <= filteredSummary.body.records);

    const csv = await get(base, `/api/transactions.csv?${filterParams}`);
    assert.equal(csv.response.status, 200);
    assert.match(csv.response.headers.get('content-type'), /text\/csv/);
    assert.equal(csv.body.trimEnd().split(/\r?\n/).length, filteredSummary.body.records + 1);
    assert.match(csv.body.split(/\r?\n/)[0], /BillNo,Order_Datetime,Outlet_Name/);

    const quality = (await get(base, '/api/quality')).body;
    assert.equal(quality.processed_records, all.body.records);
    assert.equal(quality.missing_values, 0);
    assert.equal(quality.invalid_dates, 0);
    assert.equal(quality.invalid_numeric_values, 0);
    assert.equal(quality.unique_orders, all.body.orders);

    const insights = (await get(base, '/api/insights')).body;
    assert.ok(insights.length > 0);
    assert.ok(insights.every((insight) => insight.finding && insight.action && insight.period));

    for (const route of [
      '/api/summary?start=2026-06-17&end=2025-06-17',
      '/api/summary?start=not-a-date',
      '/api/trends?granularity=year',
      '/api/transactions?page=0&pageSize=25',
      '/api/transactions?page=1&pageSize=500',
      '/api/products?sort=unknown'
    ]) {
      const { response } = await get(base, route);
      assert.equal(response.status, 400, `${route} should be rejected`);
    }

    const missingEndpoint = await get(base, '/api/not-a-route');
    assert.equal(missingEndpoint.response.status, 404);
    assert.match(missingEndpoint.response.headers.get('content-type'), /application\/json/);
    assert.equal(missingEndpoint.body.error, 'Analytics endpoint not found.');
  } finally {
    server.kill();
  }
});
