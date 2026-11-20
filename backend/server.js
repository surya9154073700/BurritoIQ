const express = require('express');
const cors = require('cors');
const duckdb = require('duckdb');
const path = require('path');

const app = express();
const port = process.env.PORT || 10000;
const parquet = path.resolve(__dirname, '..', 'data', 'processed', 'cleaned.parquet').replaceAll('\\', '/');
const db = new duckdb.Database(':memory:');
app.use(cors());
app.use(express.json());

function query(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, ...params, (error, rows) => error ? reject(error) : resolve(rows)));
}
function sendJson(res, value) {
  res.type('json').send(JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? Number(entry) : entry));
}
function filters(input = {}) {
  const where = [];
  const params = [];
  const mapping = { outlet: 'outlet_name', group: 'menu_group', item: 'item', orderType: 'order_type', settlement: 'settlement' };
  if (input.start) { where.push('order_datetime >= ?'); params.push(input.start); }
  if (input.end) { where.push('order_datetime <= ?'); params.push(`${input.end}T23:59:59Z`); }
  for (const [key, column] of Object.entries(mapping)) {
    const values = String(input[key] || '').split(',').filter(Boolean);
    if (values.length) { where.push(`${column} IN (${values.map(() => '?').join(',')})`); params.push(...values); }
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

app.get('/health', async (_req, res) => {
  try { await query(`SELECT 1 FROM read_parquet('${parquet}') LIMIT 1`); res.json({ status: 'ok' }); }
  catch (error) { res.status(503).json({ status: 'waiting-for-etl', message: error.message }); }
});
app.get('/api/summary', async (req, res) => {
  try {
    const { clause, params } = filters(req.query);
    const rows = await query(`SELECT count(*) AS records, count(DISTINCT bill_no) AS orders, sum(quantity) AS items_sold, sum(line_revenue) AS revenue, sum(line_revenue) / nullif(count(DISTINCT bill_no), 0) AS aov, sum(CASE WHEN NOT is_free_item THEN quantity ELSE 0 END) AS priced_items, sum(line_revenue) / nullif(sum(CASE WHEN NOT is_free_item THEN quantity ELSE 0 END), 0) AS average_selling_price FROM read_parquet('${parquet}') ${clause}`, params);
    sendJson(res, rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/api/metadata', async (_req, res) => {
  try {
    const rows = await query(`SELECT min(order_datetime) AS min_date, max(order_datetime) AS max_date, list(DISTINCT outlet_name ORDER BY outlet_name) AS outlets, list(DISTINCT menu_group ORDER BY menu_group) AS groups, list(DISTINCT item ORDER BY item) AS items, list(DISTINCT order_type ORDER BY order_type) AS order_types, list(DISTINCT settlement ORDER BY settlement) AS settlements, min(brand) AS brand FROM read_parquet('${parquet}')`);
    sendJson(res, rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/', (_req, res) => res.type('html').send('<h1>BurritoIQ API</h1><p>Skeleton deployment is healthy. Use <code>/health</code> and <code>/api/summary</code>.</p>'));
app.listen(port, () => console.log(`BurritoIQ API listening on ${port}`));
