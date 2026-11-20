const express = require('express');
const cors = require('cors');
const duckdb = require('duckdb');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 10000;
const parquet = path.resolve(__dirname, '..', 'data', 'processed', 'cleaned.parquet').replaceAll('\\', '/');
const db = new duckdb.Database(':memory:');
const clientBuild = path.resolve(__dirname, '..', 'dist');
const reportPath = path.resolve(__dirname, '..', 'data', 'processed', 'etl-report.json');
const responseCache = new Map();
const cacheTtlMs = 30_000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
if (fs.existsSync(clientBuild)) app.use(express.static(clientBuild));

function query(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, ...params, (error, rows) => error ? reject(error) : resolve(rows)));
}

function sendJson(res, value) {
  res.type('json').send(JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? Number(entry) : entry));
}

function validateDate(value, field) {
  if (value === undefined || value === '') return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    const error = new Error(`${field} must be a valid YYYY-MM-DD date`);
    error.status = 400;
    throw error;
  }
}

function filters(input = {}) {
  validateDate(input.start, 'start');
  validateDate(input.end, 'end');
  if (input.start && input.end && input.start > input.end) {
    const error = new Error('start must be on or before end');
    error.status = 400;
    throw error;
  }

  const where = [];
  const params = [];
  if (input.start) { where.push('CAST(order_datetime AS DATE) >= CAST(? AS DATE)'); params.push(input.start); }
  if (input.end) { where.push('CAST(order_datetime AS DATE) <= CAST(? AS DATE)'); params.push(input.end); }

  const mapping = { outlet: 'outlet_name', brand: 'brand', category: 'menu_group', group: 'menu_group', item: 'item', orderType: 'order_type', settlement: 'settlement' };
  for (const [key, column] of Object.entries(mapping)) {
    const raw = input[key];
    if (raw === undefined || raw === '') continue;
    const values = String(raw).split(',').map((value) => value.trim()).filter(Boolean);
    if (values.length > 50 || values.some((value) => value.length > 200)) {
      const error = new Error(`${key} filter exceeds the supported size`);
      error.status = 400;
      throw error;
    }
    if (values.length) {
      where.push(`${column} IN (${values.map(() => '?').join(',')})`);
      params.push(...values);
    }
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function handleError(res, error) {
  if (res.headersSent) return res.end();
  if (!error.status || error.status >= 500) console.error('Analytics request failed:', error);
  sendJson(res.status(error.status || 500), { error: error.status ? error.message : 'The analytics query could not be completed.' });
}

function endpoint(handler) {
  return async (req, res) => {
    try {
      const cacheKey = `${req.originalUrl}:${fs.statSync(parquet).mtimeMs}`;
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.createdAt < cacheTtlMs) {
        res.setHeader('Cache-Control', 'private, max-age=30');
        res.setHeader('X-Analytics-Cache', 'HIT');
        return sendJson(res, cached.value);
      }
      const value = await handler(req);
      if (responseCache.size >= 200) responseCache.delete(responseCache.keys().next().value);
      responseCache.set(cacheKey, { value, createdAt: Date.now() });
      res.setHeader('Cache-Control', 'private, max-age=30');
      res.setHeader('X-Analytics-Cache', 'MISS');
      sendJson(res, value);
    }
    catch (error) { handleError(res, error); }
  };
}

function queryFilters(req) {
  return filters(req.query);
}

app.get('/health', async (_req, res) => {
  try {
    await query(`SELECT 1 FROM read_parquet('${parquet}') LIMIT 1`);
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'waiting-for-etl', message: error.message });
  }
});

app.get('/api/metadata', endpoint(async () => {
  const rows = await query(`SELECT strftime(min(order_datetime), '%Y-%m-%dT%H:%M:%S') AS min_date, strftime(max(order_datetime), '%Y-%m-%dT%H:%M:%S') AS max_date, list(DISTINCT outlet_name ORDER BY outlet_name) AS outlets, list(DISTINCT menu_group ORDER BY menu_group) AS groups, list(DISTINCT item ORDER BY item) AS items, list(DISTINCT order_type ORDER BY order_type) AS order_types, list(DISTINCT settlement ORDER BY settlement) AS settlements, list(DISTINCT brand ORDER BY brand) AS brands, min(brand) AS brand, count(*) AS records FROM read_parquet('${parquet}')`);
  const row = rows[0];
  row.refresh_time = fs.statSync(parquet).mtime.toISOString();
  return row;
}));

app.get('/api/summary', endpoint(async (req) => {
  const { clause, params } = queryFilters(req);
  const rows = await query(`SELECT count(*) AS records, count(DISTINCT bill_no) AS orders, sum(quantity) AS items_sold, sum(line_revenue) AS revenue, sum(line_revenue) / nullif(count(DISTINCT bill_no), 0) AS aov, sum(CASE WHEN NOT is_free_item THEN quantity ELSE 0 END) AS priced_items, sum(line_revenue) / nullif(sum(CASE WHEN NOT is_free_item THEN quantity ELSE 0 END), 0) AS average_selling_price, count(DISTINCT outlet_name) AS outlets, count(DISTINCT item) AS products FROM read_parquet('${parquet}') ${clause}`, params);
  return rows[0];
}));

app.get('/api/monthly', endpoint(async (req) => {
  const { clause, params } = queryFilters(req);
  const rows = await query(`SELECT strftime(order_datetime, '%Y-%m') AS month, sum(line_revenue) AS revenue, count(DISTINCT bill_no) AS orders FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY 1`, params);
  return rows.map((row) => ({ ...row, partial: row.month === '2025-06' || row.month === '2026-06' }));
}));

app.get('/api/outlets', endpoint(async (req) => {
  const { clause, params } = queryFilters(req);
  return query(`SELECT outlet_name AS outlet, sum(line_revenue) AS revenue, count(DISTINCT bill_no) AS orders, sum(quantity) AS items_sold, sum(line_revenue) / nullif(count(DISTINCT bill_no), 0) AS aov FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY revenue DESC`, params);
}));

app.get('/api/trends', endpoint(async (req) => {
  const granularity = req.query.granularity || 'day';
  const formats = { day: ['day', '%Y-%m-%d'], week: ['week', '%G-W%V'], month: ['month', '%Y-%m'] };
  if (!Object.hasOwn(formats, granularity)) {
    const error = new Error('granularity must be day, week, or month');
    error.status = 400;
    throw error;
  }
  const [unit, format] = formats[granularity];
  const { clause, params } = queryFilters(req);
  return query(`SELECT strftime(date_trunc('${unit}', order_datetime), '${format}') AS period, sum(line_revenue) AS revenue, count(DISTINCT bill_no) AS orders, sum(quantity) AS items_sold FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY 1`, params);
}));

app.get('/api/products', endpoint(async (req) => {
  const sortColumns = { revenue: 'revenue', quantity: 'quantity', orders: 'orders', item: 'item', averagePrice: 'average_price' };
  const sort = sortColumns[req.query.sort || 'revenue'];
  if (!sort) {
    const error = new Error('Unsupported product sort');
    error.status = 400;
    throw error;
  }
  const direction = req.query.direction === 'asc' ? 'ASC' : 'DESC';
  const { clause, params } = queryFilters(req);
  return query(`SELECT item, menu_group AS category, sum(line_revenue) AS revenue, sum(quantity) AS quantity, count(DISTINCT bill_no) AS orders, sum(line_revenue) / nullif(sum(CASE WHEN NOT is_free_item THEN quantity ELSE 0 END), 0) AS average_price FROM read_parquet('${parquet}') ${clause} GROUP BY item, menu_group ORDER BY ${sort} ${direction}, item ASC`, params);
}));

app.get('/api/categories', endpoint(async (req) => {
  const { clause, params } = queryFilters(req);
  return query(`SELECT menu_group AS category, sum(line_revenue) AS revenue, sum(quantity) AS quantity, count(DISTINCT bill_no) AS orders FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY revenue DESC`, params);
}));

app.get('/api/order-analytics', endpoint(async (req) => {
  const { clause, params } = queryFilters(req);
  const base = `FROM read_parquet('${parquet}') ${clause}`;
  const [types, settlements, hours, weekdays] = await Promise.all([
    query(`SELECT order_type AS name, sum(line_revenue) AS revenue, count(DISTINCT bill_no) AS orders, sum(line_revenue) / nullif(count(DISTINCT bill_no), 0) AS aov FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY revenue DESC`, params),
    query(`SELECT settlement AS name, sum(line_revenue) AS revenue, count(DISTINCT bill_no) AS orders FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY revenue DESC`, params),
    query(`SELECT CAST(strftime(order_datetime, '%H') AS INTEGER) AS hour, sum(line_revenue) AS revenue, count(DISTINCT bill_no) AS orders FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY 1`, params),
    query(`SELECT CAST(strftime(order_datetime, '%w') AS INTEGER) AS weekday_index, strftime(order_datetime, '%A') AS weekday, sum(line_revenue) AS revenue, count(DISTINCT bill_no) AS orders FROM read_parquet('${parquet}') ${clause} GROUP BY 1, 2 ORDER BY 1`, params)
  ]);
  return { orderTypes: types, settlements, hours, weekdays };
}));

app.get('/api/quality', endpoint(async () => {
  const [summary] = await query(`SELECT count(*) AS processed_records, count(DISTINCT bill_no) AS unique_orders, count(DISTINCT outlet_name) AS unique_outlets, count(DISTINCT item) AS unique_products, count(*) FILTER (WHERE bill_no IS NULL OR outlet_name IS NULL OR order_datetime IS NULL OR menu_group IS NULL OR order_type IS NULL OR item IS NULL OR price IS NULL OR quantity IS NULL OR settlement IS NULL OR brand IS NULL) AS missing_values, count(*) FILTER (WHERE NOT isfinite(price) OR NOT isfinite(quantity)) AS invalid_numeric_values, count(*) FILTER (WHERE order_datetime IS NULL) AS invalid_dates, strftime(min(order_datetime), '%Y-%m-%dT%H:%M:%S') AS min_date, strftime(max(order_datetime), '%Y-%m-%dT%H:%M:%S') AS max_date FROM read_parquet('${parquet}')`);
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {};
  return {
    ...summary,
    ingested_records: report.inputRecords ?? summary.processed_records,
    rejected_records: report.rejectedRecords ?? 0,
    duplicate_candidates: report.exactDuplicatesFound ?? 0,
    processing_time_ms: report.durationMs ?? null,
    last_processed_at: fs.existsSync(reportPath) ? fs.statSync(reportPath).mtime.toISOString() : null,
    data_range: { start: summary.min_date, end: summary.max_date },
    rules: [
      'Rows missing BillNo, required dimensions, a valid Excel date, or finite Price/Quantity are rejected and counted.',
      'Exact duplicate candidates are reported but retained; no rows are silently deduplicated.',
      'BillNo is counted as a distinct order even when it contains multiple item rows.',
      'Zero-price lines are retained and included in items sold; they are excluded from average selling price.'
    ]
  };
}));

app.get('/api/insights', endpoint(async (req) => {
  const { clause, params } = queryFilters(req);
  const [summary] = await query(`SELECT sum(line_revenue) AS revenue, count(DISTINCT bill_no) AS orders FROM read_parquet('${parquet}') ${clause}`, params);
  const [outlets, products, categories, types, settlements, weekdays, hours] = await Promise.all([
    query(`SELECT outlet_name AS name, sum(line_revenue) AS revenue FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY revenue DESC`, params),
    query(`SELECT item AS name, sum(quantity) AS quantity, sum(line_revenue) AS revenue FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY quantity DESC`, params),
    query(`SELECT menu_group AS name, sum(line_revenue) AS revenue FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY revenue DESC`, params),
    query(`SELECT order_type AS name, sum(line_revenue) AS revenue FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY revenue DESC`, params),
    query(`SELECT settlement AS name, count(DISTINCT bill_no) AS orders, sum(line_revenue) AS revenue FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY orders DESC`, params),
    query(`SELECT strftime(order_datetime, '%A') AS name, sum(line_revenue) AS revenue, count(DISTINCT bill_no) AS orders FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY orders DESC`, params),
    query(`SELECT strftime(order_datetime, '%H:00') AS name, count(DISTINCT bill_no) AS orders, sum(line_revenue) AS revenue FROM read_parquet('${parquet}') ${clause} GROUP BY 1 ORDER BY orders DESC`, params)
  ]);
  const insights = [];
  const add = (category, title, finding, metric, implication, action) => insights.push({ category, title, finding, metric, period: `${req.query.start || 'All dates'} to ${req.query.end || 'All dates'}`, implication, action });
  if (outlets[0]) add('Outlet performance', 'Leading outlet by revenue', `${outlets[0].name} generated the most revenue in this filtered view.`, outlets[0].revenue, 'Revenue is concentrated among the highest-ranked locations.', 'Compare this outlet’s order mix with other locations before applying its practices elsewhere.');
  if (categories[0]) add('Revenue opportunities', 'Highest-revenue category', `${categories[0].name} leads menu categories by revenue.`, categories[0].revenue, 'This category is the largest revenue contributor in the selected data.', 'Review category mix alongside item-level quantities and outlet patterns.');
  if (products[0]) add('Product performance', 'Top-selling item by quantity', `${products[0].name} has the highest quantity sold.`, products[0].quantity, 'This item accounts for the most units sold in the filtered view.', 'Check availability and consistency across locations; sales alone do not indicate margin.');
  if (products.length) {
    const slowest = [...products].sort((a, b) => Number(a.quantity) - Number(b.quantity) || a.name.localeCompare(b.name))[0];
    add('Product performance', 'Lowest-selling item by quantity', `${slowest.name} has the lowest quantity among items with recorded sales.`, slowest.quantity, 'This is a relative sales ranking and does not indicate profitability.', 'Review the menu placement and availability context before deciding whether to change the offer.');
  }
  if (types[0]) add('Customer ordering patterns', 'Leading order type by revenue', `${types[0].name} contributes the most revenue by order type.`, types[0].revenue, 'Order channel mix affects how revenue is distributed.', 'Compare channel mix by outlet and settlement before planning channel-specific changes.');
  if (settlements[0]) add('Operational observations', 'Most common settlement method', `${settlements[0].name} appears on the most distinct bills.`, settlements[0].orders, 'This is the most frequently used settlement label in the selected data.', 'Confirm settlement reconciliation procedures cover this method.');
  if (weekdays[0]) add('Customer ordering patterns', 'Busiest weekday', `${weekdays[0].name} has the highest order count.`, weekdays[0].orders, 'Order volume varies by weekday in the selected period.', 'Use this pattern as a planning signal, not as evidence of a cause.');
  if (hours[0]) add('Operational observations', 'Peak ordering hour', `${hours[0].name} has the highest order count.`, hours[0].orders, 'Order volume is highest in this recorded hour.', 'Review staffing and prep plans against other operational data.');
  if (Number(summary.orders)) add('Revenue opportunities', 'Revenue per order', `Filtered revenue averages ${(Number(summary.revenue) / Number(summary.orders)).toFixed(2)} per distinct bill.`, Number(summary.revenue) / Number(summary.orders), 'Average order value describes basket revenue, not customer lifetime value.', 'Compare this metric across comparable dates and channels.');
  return insights;
}));

app.get('/api/transactions', endpoint(async (req) => {
  const { clause, params } = queryFilters(req);
  const search = String(req.query.search || '').trim();
  if (search.length > 200) {
    const error = new Error('search must be 200 characters or fewer');
    error.status = 400;
    throw error;
  }
  const searchClause = search ? `${clause ? ' AND' : 'WHERE'} (contains(lower(bill_no), lower(?)) OR contains(lower(item), lower(?)))` : '';
  const queryParams = search ? [...params, search, search] : params;
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 50);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    const error = new Error('page must be positive and pageSize must be between 1 and 200');
    error.status = 400;
    throw error;
  }
  const sortColumns = { billNo: 'bill_no_sort', date: 'order_datetime', outlet: 'outlet_name', brand: 'brand', category: 'menu_group', item: 'item', price: 'price', quantity: 'quantity', revenue: 'line_revenue', orderType: 'order_type', settlement: 'settlement' };
  const sort = sortColumns[req.query.sort || 'date'];
  if (!sort) {
    const error = new Error('Unsupported transaction sort');
    error.status = 400;
    throw error;
  }
  const direction = req.query.direction === 'asc' ? 'ASC' : 'DESC';
  const condition = `${clause}${searchClause}`;
  const [count] = await query(`SELECT count(*) AS total FROM read_parquet('${parquet}') ${condition}`, queryParams);
  const rows = await query(`SELECT bill_no AS billNo, strftime(order_datetime, '%Y-%m-%dT%H:%M:%S') AS orderDatetime, outlet_name AS outlet, brand, menu_group AS category, item, price, quantity, line_revenue AS revenue, order_type AS orderType, settlement FROM read_parquet('${parquet}') ${condition} ORDER BY ${sort} ${direction} LIMIT ? OFFSET ?`, [...queryParams, pageSize, (page - 1) * pageSize]);
  const total = Number(count.total);
  return { rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}));

app.get('/api/transactions.csv', async (req, res) => {
  try {
    const { clause, params } = queryFilters(req);
    const search = String(req.query.search || '').trim();
    if (search.length > 200) {
      const error = new Error('search must be 200 characters or fewer');
      error.status = 400;
      throw error;
    }
    const searchClause = search ? `${clause ? ' AND' : 'WHERE'} (contains(lower(bill_no), lower(?)) OR contains(lower(item), lower(?)))` : '';
    const queryParams = search ? [...params, search, search] : params;
    const result = await query(`SELECT bill_no AS BillNo, strftime(order_datetime, '%Y-%m-%dT%H:%M:%S') AS Order_Datetime, outlet_name AS Outlet_Name, brand AS Brand, menu_group AS "Group", item AS Item, price AS Price, quantity AS Quantity, line_revenue AS Line_Revenue, order_type AS Order_Type, settlement AS Settlement FROM read_parquet('${parquet}') ${clause}${searchClause} ORDER BY order_datetime DESC`, queryParams);
    const headers = ['BillNo', 'Order_Datetime', 'Outlet_Name', 'Brand', 'Group', 'Item', 'Price', 'Quantity', 'Line_Revenue', 'Order_Type', 'Settlement'];
    const csvValue = (value) => {
      const text = String(value ?? '');
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    res.type('text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="burritoiq-transactions.csv"');
    res.write(`${headers.join(',')}\r\n`);
    for (let index = 0; index < result.length; index += 1000) {
      const lines = result.slice(index, index + 1000).map((row) => headers.map((header) => csvValue(row[header])).join(','));
      if (!res.write(`${lines.join('\r\n')}${lines.length ? '\r\n' : ''}`)) await new Promise((resolve) => res.once('drain', resolve));
    }
    res.end();
  } catch (error) { handleError(res, error); }
});

app.use('/api', (_req, res) => sendJson(res.status(404), { error: 'Analytics endpoint not found.' }));

app.use((_req, res) => fs.existsSync(path.join(clientBuild, 'index.html'))
  ? res.sendFile(path.join(clientBuild, 'index.html'))
  : res.type('html').send('<h1>BurritoIQ API</h1><p>Skeleton deployment is healthy.</p>'));

query("SET TimeZone = 'UTC'")
  .then(() => app.listen(port, () => console.log(`BurritoIQ API listening on ${port}`)))
  .catch((error) => {
    console.error('Could not configure the analytics timezone:', error);
    process.exitCode = 1;
  });
