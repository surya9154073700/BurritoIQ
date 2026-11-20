const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const duckdb = require('duckdb');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const sourceArg = args.indexOf('--source');
const source = path.resolve(root, sourceArg >= 0 ? args[sourceArg + 1] : 'data/raw/data.xlsx');
const outputDir = path.join(root, 'data', 'processed');
const parquetPath = path.join(outputDir, 'cleaned.parquet');
const csvPath = path.join(outputDir, 'cleaned.csv');

if (!fs.existsSync(source)) throw new Error(`Workbook not found: ${source}`);
fs.mkdirSync(outputDir, { recursive: true });

function excelDate(serial) {
  if (!Number.isFinite(serial)) return null;
  return new Date(Math.round((serial - 25569) * 86400) * 1000).toISOString().replace('.000Z', 'Z');
}
function billId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Math.trunc(numeric)) : String(value).trim();
}
function csvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, ...params, (error) => error ? reject(error) : resolve()));
}
function close(db) {
  return new Promise((resolve) => db.close(resolve));
}

const started = Date.now();
const workbook = XLSX.readFile(source, { cellDates: false, raw: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
const required = ['BillNo', 'Outlet_Name', 'Order_Datetime', 'Group', 'Order_Type', 'Item', 'Price', 'Quantity', 'Settlement', 'Brand'];
const missing = required.filter((column) => !Object.hasOwn(rawRows[0] || {}, column));
if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);

let rejected = 0;
let duplicateRows = 0;
const seen = new Set();
const cleaned = [];
for (const row of rawRows) {
  const rawKey = required.map((key) => String(row[key] ?? '')).join('\u001f');
  if (seen.has(rawKey)) duplicateRows += 1;
  seen.add(rawKey);
  const price = Number(row.Price);
  const quantity = Number(row.Quantity);
  const orderDatetime = excelDate(Number(row.Order_Datetime));
  const requiredText = ['Outlet_Name', 'Group', 'Order_Type', 'Item', 'Settlement', 'Brand'].every((key) => String(row[key] ?? '').trim());
  if (!billId(row.BillNo) || !orderDatetime || !Number.isFinite(price) || !Number.isFinite(quantity) || !requiredText) {
    rejected += 1;
    continue;
  }
  cleaned.push({
    bill_no: billId(row.BillNo),
    bill_no_sort: Number(row.BillNo),
    outlet_name: String(row.Outlet_Name).trim(),
    order_datetime: orderDatetime,
    menu_group: String(row.Group).trim(),
    order_type: String(row.Order_Type).trim(),
    item: String(row.Item).trim(),
    price,
    quantity,
    settlement: String(row.Settlement).trim(),
    brand: String(row.Brand).trim(),
    is_free_item: price === 0,
    line_revenue: price * quantity
  });
}

const header = Object.keys(cleaned[0]);
fs.writeFileSync(csvPath, [header.join(','), ...cleaned.map((row) => header.map((key) => csvValue(row[key])).join(','))].join('\n'));
const db = new duckdb.Database(':memory:');
(async () => {
  const safeCsv = csvPath.replaceAll('\\', '/').replaceAll("'", "''");
  const safeParquet = parquetPath.replaceAll('\\', '/').replaceAll("'", "''");
  await run(db, `COPY (SELECT * FROM read_csv_auto('${safeCsv}', HEADER=true)) TO '${safeParquet}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
  await close(db);
  // Windows may briefly retain DuckDB's file handle. The temporary CSV is ignored by Git.
  try { fs.unlinkSync(csvPath); } catch (error) { if (error.code !== 'EBUSY') throw error; }
  const revenue = cleaned.reduce((sum, row) => sum + row.line_revenue, 0);
  const items = cleaned.reduce((sum, row) => sum + row.quantity, 0);
  const orders = new Set(cleaned.map((row) => row.bill_no)).size;
  const report = {
    source: path.relative(root, source),
    inputRecords: rawRows.length,
    cleanedRecords: cleaned.length,
    rejectedRecords: rejected,
    exactDuplicatesFound: duplicateRows,
    dateRange: {
      min: cleaned.reduce((min, row) => row.order_datetime < min ? row.order_datetime : min, cleaned[0].order_datetime),
      max: cleaned.reduce((max, row) => row.order_datetime > max ? row.order_datetime : max, cleaned[0].order_datetime)
    },
    reconciliation: { revenue, orders, itemsSold: items, aov: revenue / orders, records: cleaned.length },
    durationMs: Date.now() - started
  };
  fs.writeFileSync(path.join(outputDir, 'etl-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { db.close(); throw error; });
