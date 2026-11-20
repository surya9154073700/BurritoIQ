import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';

const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const colors = ['#1f6955', '#e17d4b', '#d2a13c', '#7696bd', '#8e79a7', '#50a39c', '#d67e8a'];
const navItems = [
  ['overview', 'Executive Overview', '◫'],
  ['sales', 'Sales Analytics', '↗'],
  ['products', 'Product Intelligence', '◇'],
  ['outlets', 'Outlet Performance', '⌖'],
  ['orders', 'Order & Payment Analytics', '◷'],
  ['explorer', 'Data Explorer', '▤'],
  ['quality', 'Data Quality', '✓'],
  ['insights', 'Business Insights', '✳']
];
const pageTitles = Object.fromEntries(navItems.map(([id, title]) => [id, title]));
const initialFilters = { start: '2025-06-17', end: '2026-06-16', outlet: '', brand: '', category: '', item: '', orderType: '', settlement: '' };
const fmt = (value) => number.format(Number(value) || 0);
const fmtDecimal = (value) => decimal.format(Number(value) || 0);

async function request(path, signal) {
  const response = await fetch(path, { signal });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const body = await response.text();
    const detail = contentType.includes('text/html')
      ? 'The API returned an HTML page instead of JSON. Check that the frontend is reaching the analytics API, not a stale server or the Vite page fallback.'
      : `The API returned ${contentType || 'an unknown content type'} instead of JSON.`;
    throw new Error(`${path}: ${detail}${body && !contentType.includes('text/html') ? ` ${body.slice(0, 200)}` : ''}`);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${path}: the API returned invalid JSON.`);
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function useApiData(paths) {
  const key = paths.join('|');
  const [state, setState] = useState({ data: [], loading: true, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: '' }));
    Promise.all(paths.map((path) => request(path, controller.signal)))
      .then((data) => setState({ data, loading: false, error: '' }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState((current) => ({ ...current, loading: false, error: error.message }));
      });
    return () => controller.abort();
  }, [key]);
  return state;
}

function queryString(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== '' && value !== undefined) params.set(key, value); });
  return params.toString();
}

function App() {
  const [page, setPage] = useState('overview');
  const [filters, setFilters] = useState(initialFilters);
  const [granularity, setGranularity] = useState('month');
  const [search, setSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState('date');
  const [direction, setDirection] = useState('desc');
  const [compareOutlets, setCompareOutlets] = useState(['', '']);
  const metaState = useApiData(['/api/metadata']);
  const meta = metaState.data[0];
  const filterQuery = queryString(filters);
  const base = (path) => `${path}${path.includes('?') ? '&' : '?'}${filterQuery}`;
  const transactionParams = queryString({ ...filters, search, page: tablePage, pageSize, sort, direction });

  const endpoints = useMemo(() => {
    if (page === 'overview') return [
      base('/api/summary'), base(`/api/trends?granularity=${granularity}`), base('/api/outlets'),
      base('/api/categories'), base('/api/products?sort=quantity'), base('/api/order-analytics')
    ];
    if (page === 'sales') return [base(`/api/trends?granularity=${granularity}`), base('/api/categories'), base('/api/outlets'), base('/api/summary')];
    if (page === 'products') return [base('/api/products?sort=quantity'), base('/api/categories')];
    if (page === 'outlets') return [base('/api/outlets'), base('/api/summary')];
    if (page === 'orders') return [base('/api/order-analytics')];
    if (page === 'explorer') return [`/api/transactions?${transactionParams}`];
    if (page === 'quality') return ['/api/quality'];
    return [base('/api/insights')];
  }, [page, filterQuery, granularity, transactionParams]);
  const dataState = useApiData(endpoints);
  const data = dataState.data;
  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    if (page === 'explorer') setTablePage(1);
  };
  const reset = () => {
    setFilters({ ...initialFilters });
    setSearch('');
    setTablePage(1);
  };

  if (metaState.error) return <main className="fatal"><h1>Could not load BurritoIQ data</h1><p>{metaState.error}</p><p>Confirm the API is healthy at port 10000 and refresh this page.</p></main>;
  if (!meta) return <main className="fatal">Loading restaurant intelligence…</main>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark">B</span><span><b>BurritoIQ</b><small>RESTAURANT INTELLIGENCE</small></span></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navItems.map(([id, label, icon]) => <button key={id} className={`nav-link ${page === id ? 'selected' : ''}`} onClick={() => setPage(id)}><span className="nav-icon">{icon}</span>{label}</button>)}
        </nav>
        <div className="sidebar-bottom"><span className="health-dot" /> Data pipeline healthy <small>{fmt(meta.records)} rows indexed</small></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div><p className="eyebrow">BURGER TOWN · ANALYTICS</p><h1>{pageTitles[page]}</h1></div><div className="refresh-indicator"><span className="health-dot" />Data ready<small>Updated {new Date(meta.refresh_time).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small></div></header>
        <section className="filter-bar" aria-label="Global filters">
          <label>Date from<input aria-label="Start date" type="date" value={filters.start} min={meta.min_date.slice(0, 10)} max={filters.end || meta.max_date.slice(0, 10)} onChange={(event) => updateFilter('start', event.target.value)} /></label>
          <label>Date to<input aria-label="End date" type="date" value={filters.end} min={filters.start || meta.min_date.slice(0, 10)} max={meta.max_date.slice(0, 10)} onChange={(event) => updateFilter('end', event.target.value)} /></label>
          <SelectFilter label="Outlet" value={filters.outlet} values={meta.outlets} onChange={(value) => updateFilter('outlet', value)} />
          <SelectFilter label="Brand" value={filters.brand} values={meta.brands || [meta.brand]} onChange={(value) => updateFilter('brand', value)} />
          <SelectFilter label="Category" value={filters.category} values={meta.groups} onChange={(value) => updateFilter('category', value)} />
          <SelectFilter label="Menu item" value={filters.item} values={meta.items} onChange={(value) => updateFilter('item', value)} />
          <SelectFilter label="Order type" value={filters.orderType} values={meta.order_types} onChange={(value) => updateFilter('orderType', value)} />
          <SelectFilter label="Settlement" value={filters.settlement} values={meta.settlements} onChange={(value) => updateFilter('settlement', value)} />
          <button className="reset-button" onClick={reset}>Reset filters</button>
        </section>
        <div className="active-filter-row"><span>{Object.values(filters).filter(Boolean).length} active filters</span>{Object.entries(filters).filter(([, value]) => value).map(([key, value]) => <button key={key} className="filter-chip" onClick={() => updateFilter(key, '')}>{key === 'start' || key === 'end' ? value : value} <b>×</b></button>)}</div>
        {dataState.loading && <div className="loading-bar" aria-label="Loading analytics"><span /></div>}
        {dataState.error ? <section className="panel analytics-error" role="alert"><h2>Analytics could not be refreshed</h2><p>{dataState.error}</p></section> : <>
          {page === 'overview' && <Overview data={data} meta={meta} granularity={granularity} setGranularity={setGranularity} loading={dataState.loading} />}
          {page === 'sales' && <Sales data={data} granularity={granularity} setGranularity={setGranularity} loading={dataState.loading} />}
          {page === 'products' && <Products data={data} loading={dataState.loading} />}
          {page === 'outlets' && <Outlets data={data} meta={meta} compareOutlets={compareOutlets} setCompareOutlets={setCompareOutlets} loading={dataState.loading} />}
          {page === 'orders' && <Orders analytics={data[0]} loading={dataState.loading} />}
          {page === 'explorer' && <Explorer result={data[0]} search={search} setSearch={(value) => { setSearch(value); setTablePage(1); }} page={tablePage} setPage={setTablePage} pageSize={pageSize} setPageSize={(value) => { setPageSize(value); setTablePage(1); }} sort={sort} setSort={setSort} direction={direction} setDirection={setDirection} filters={filters} />}
          {page === 'quality' && <Quality quality={data[0]} loading={dataState.loading} />}
          {page === 'insights' && <Insights insights={data[0]} loading={dataState.loading} />}
        </>}
        <footer className="page-footer">Revenue is shown without a currency symbol because the source workbook does not specify a currency. Sales metrics are descriptive and do not imply profitability or causation.</footer>
      </main>
    </div>
  );
}

function SelectFilter({ label, value, values = [], onChange }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">All {label.toLowerCase()}s</option>{values.map((entry) => <option value={entry} key={entry}>{entry}</option>)}</select></label>;
}

function Metric({ label, value, detail, tip }) {
  return <article className="metric-card" title={tip}><div className="metric-label">{label}<span className="info-mark" aria-label={tip}>i</span></div><strong>{value}</strong><small>{detail}</small></article>;
}

function ChartPanel({ title, subtitle, children, className = '' }) {
  return <article className={`panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div><div className="panel-content">{children}</div></article>;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><b>{label}</b>{payload.map((point) => <span key={point.dataKey}><i style={{ background: point.color || point.fill }} />{point.name || point.dataKey}: {fmt(point.value)}</span>)}</div>;
}

function Granularity({ value, onChange }) {
  return <div className="segmented-control" aria-label="Chart granularity">{['day', 'week', 'month'].map((unit) => <button key={unit} className={value === unit ? 'active' : ''} onClick={() => onChange(unit)}>{unit}</button>)}</div>;
}

function Empty({ text = 'No records match the selected filters.' }) {
  return <div className="empty-state"><span>—</span>{text}</div>;
}

function Overview({ data, meta, granularity, setGranularity, loading }) {
  const [summary, trends = [], outlets = [], categories = [], products = [], orders] = data;
  if (loading && !summary) return <Skeleton />;
  const top = outlets[0];
  const product = products[0];
  const category = categories[0];
  return <>
    <div className="section-intro"><div><h2>Performance at a glance</h2><p>Decision-ready metrics across your selected date range.</p></div><span className="dataset-tag"><span className="health-dot" />{fmt(meta.records)} records processed</span></div>
    <section className="metric-grid">
      <Metric label="Total revenue" value={fmt(summary?.revenue)} detail="Price × quantity" tip="Sum of line-item price multiplied by quantity in the selected filters." />
      <Metric label="Total orders" value={fmt(summary?.orders)} detail="Distinct BillNo values" tip="Distinct BillNo values; a bill may contain multiple item rows." />
      <Metric label="Average order value" value={fmtDecimal(summary?.aov)} detail="Revenue ÷ distinct orders" tip="Filtered revenue divided by the distinct number of bills." />
      <Metric label="Items sold" value={fmt(summary?.items_sold)} detail="Includes free items" tip="Sum of quantity, including zero-price lines." />
      <Metric label="Outlets in view" value={fmt(summary?.outlets)} detail="Distinct filtered outlets" tip="Number of outlets represented after the active filters." />
      <Metric label="Records processed" value={fmt(meta.records)} detail="Workbook line items" tip="All successfully processed records in the source workbook." />
    </section>
    <section className="chart-grid overview-grid">
      <ChartPanel title="Revenue trend" subtitle="Revenue and order volume over time" className="span-two"><Granularity value={granularity} onChange={setGranularity} /><div className="chart-frame"><ResponsiveContainer width="100%" height={280}><ComposedChart data={trends}><CartesianGrid vertical={false} stroke="#edf0eb" /><XAxis dataKey="period" tickLine={false} axisLine={false} minTickGap={24} /><YAxis yAxisId="revenue" tickFormatter={fmt} tickLine={false} axisLine={false} width={66} /><YAxis yAxisId="orders" orientation="right" hide /><Tooltip content={<ChartTooltip />} /><Legend /><Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#e9eee9" radius={[4, 4, 0, 0]} /><Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Revenue" stroke="#1f6955" strokeWidth={3} dot={false} activeDot={{ r: 5 }} /></ComposedChart></ResponsiveContainer>{!trends.length && <Empty />}</div></ChartPanel>
      <ChartPanel title="Revenue by category" subtitle="Category contribution"><div className="chart-frame"><ResponsiveContainer width="100%" height={280}><BarChart data={categories.slice(0, 7)} layout="vertical" margin={{ left: 12, right: 12 }}><CartesianGrid horizontal={false} stroke="#edf0eb" /><XAxis type="number" tickFormatter={fmt} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="category" width={85} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="revenue" name="Revenue" fill="#1f6955" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer>{!categories.length && <Empty />}</div></ChartPanel>
      <ChartPanel title="Order distribution" subtitle="Revenue by order type"><Donut rows={orders?.orderTypes} valueKey="revenue" nameKey="name" /></ChartPanel>
      <ChartPanel title="Outlet ranking" subtitle="Ranked by revenue"><div className="chart-frame"><ResponsiveContainer width="100%" height={250}><BarChart data={outlets.slice(0, 6)} margin={{ bottom: 28 }}><CartesianGrid vertical={false} stroke="#edf0eb" /><XAxis dataKey="outlet" tickLine={false} axisLine={false} interval={0} angle={-15} textAnchor="end" height={55} /><YAxis tickFormatter={fmt} tickLine={false} axisLine={false} width={62} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="revenue" name="Revenue" fill="#d8794a" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>{!outlets.length && <Empty />}</div></ChartPanel>
      <ChartPanel title="Top-selling products" subtitle="Highest units sold"><div className="ranking-list">{products.slice(0, 10).map((row, index) => <Rank key={row.item} index={index} label={row.item} value={row.quantity} />)}{!products.length && <Empty />}</div></ChartPanel>
    </section>
    <section className="executive-note"><span className="note-icon">✳</span><div><b>Executive readout</b><p>{top ? `${top.outlet} leads the selected view with ${fmt(top.revenue)} revenue across ${fmt(top.orders)} distinct orders.` : 'No records match the current filters.'} {category ? `${category.category} is the top revenue category.` : ''} {product ? `${product.item} leads in units sold.` : ''} These are descriptive patterns, not causal or profitability claims.</p></div></section>
  </>;
}

function Sales({ data, granularity, setGranularity, loading }) {
  const [trends = [], categories = [], outlets = [], summary] = data;
  if (loading && !trends.length) return <Skeleton />;
  return <>
    <div className="metric-grid compact"><Metric label="Revenue" value={fmt(summary?.revenue)} detail="Filtered sales" tip="Sum of Price × Quantity." /><Metric label="Orders" value={fmt(summary?.orders)} detail="Distinct bills" tip="Count of distinct BillNo values." /><Metric label="Average order value" value={fmtDecimal(summary?.aov)} detail="Revenue / orders" tip="Revenue divided by distinct BillNo values." /><Metric label="Items sold" value={fmt(summary?.items_sold)} detail="Including free items" tip="Sum of quantity." /></div>
    <section className="chart-grid">
      <ChartPanel title="Revenue and order trend" subtitle="Compare volume and revenue over time" className="span-two"><Granularity value={granularity} onChange={setGranularity} /><div className="chart-frame"><ResponsiveContainer width="100%" height={330}><ComposedChart data={trends}><CartesianGrid vertical={false} stroke="#edf0eb" /><XAxis dataKey="period" minTickGap={28} tickLine={false} axisLine={false} /><YAxis yAxisId="revenue" tickFormatter={fmt} tickLine={false} axisLine={false} /><YAxis yAxisId="orders" orientation="right" hide /><Tooltip content={<ChartTooltip />} /><Legend /><Line yAxisId="revenue" dataKey="revenue" name="Revenue" stroke="#1f6955" strokeWidth={3} dot={false} /><Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#e8b17f" radius={[3, 3, 0, 0]} /></ComposedChart></ResponsiveContainer>{!trends.length && <Empty />}</div></ChartPanel>
      <ChartPanel title="Category contribution" subtitle="Revenue across menu categories"><div className="chart-frame"><ResponsiveContainer width="100%" height={280}><BarChart data={categories} layout="vertical" margin={{ left: 14, right: 18 }}><CartesianGrid horizontal={false} stroke="#edf0eb" /><XAxis type="number" tickFormatter={fmt} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="category" width={80} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="revenue" fill="#1f6955" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer>{!categories.length && <Empty />}</div></ChartPanel>
      <ChartPanel title="Revenue by outlet" subtitle="Outlet sales ranking"><SimpleTable headings={['Outlet', 'Revenue', 'Orders', 'AOV']} rows={outlets.map((row) => [row.outlet, fmt(row.revenue), fmt(row.orders), fmtDecimal(row.aov)])} /></ChartPanel>
    </section>
  </>;
}

function Products({ data, loading }) {
  const [products = [], categories = []] = data;
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('quantity');
  const [direction, setDirection] = useState('desc');
  if (loading && !products.length) return <Skeleton />;
  const bottom = [...products].sort((a, b) => a.quantity - b.quantity).slice(0, 10);
  const visibleProducts = products
    .filter((row) => `${row.item} ${row.category}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const left = a[sortKey], right = b[sortKey];
      const order = typeof left === 'string' ? String(left).localeCompare(String(right)) : Number(left) - Number(right);
      return direction === 'asc' ? order : -order;
    });
  return <>
    <div className="section-intro"><div><h2>Menu item performance</h2><p>Ranked from transaction-level sales; no product cost data is available.</p></div></div>
    <section className="chart-grid">
      <ChartPanel title="Top 10 items by quantity" subtitle="Units sold"><RankedBars rows={products.slice(0, 10)} labelKey="item" valueKey="quantity" /></ChartPanel>
      <ChartPanel title="Lowest 10 items by quantity" subtitle="Among products with sales"><RankedBars rows={bottom} labelKey="item" valueKey="quantity" /></ChartPanel>
      <ChartPanel title="Category mix" subtitle="Revenue by menu group"><Donut rows={categories} valueKey="revenue" nameKey="category" /></ChartPanel>
      <ChartPanel title="Menu performance table" subtitle={`${visibleProducts.length} of ${products.length} items`} className="span-two"><div className="table-controls product-controls"><label>Search product<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Product or category" /></label><label>Sort by<select value={sortKey} onChange={(event) => setSortKey(event.target.value)}><option value="quantity">Quantity sold</option><option value="revenue">Revenue</option><option value="orders">Orders</option><option value="average_price">Average selling price</option><option value="item">Product name</option></select></label><label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label></div><div className="table-scroll"><table><thead><tr><th>Product</th><th>Category</th><th>Quantity</th><th>Orders</th><th>Revenue</th><th>Avg. selling price</th></tr></thead><tbody>{visibleProducts.map((row) => <tr key={`${row.category}-${row.item}`}><td>{row.item}</td><td>{row.category}</td><td>{fmt(row.quantity)}</td><td>{fmt(row.orders)}</td><td>{fmt(row.revenue)}</td><td>{fmtDecimal(row.average_price)}</td></tr>)}</tbody></table>{!visibleProducts.length && <Empty />}</div></ChartPanel>
    </section>
  </>;
}

function Outlets({ data, meta, compareOutlets, setCompareOutlets, loading }) {
  const [outlets = [], summary] = data;
  if (loading && !outlets.length) return <Skeleton />;
  const selected = compareOutlets.map((name) => outlets.find((row) => row.outlet === name)).filter(Boolean);
  const setChoice = (index, value) => setCompareOutlets((current) => current.map((item, i) => i === index ? value : item));
  return <>
    <section className="metric-grid compact"><Metric label="Revenue" value={fmt(summary?.revenue)} detail="Filtered sales" tip="Sum of Price × Quantity." /><Metric label="Orders" value={fmt(summary?.orders)} detail="Distinct bills" tip="Count of distinct BillNo values." /><Metric label="Outlets" value={fmt(summary?.outlets)} detail="In selected data" tip="Distinct outlets in the current selection." /><Metric label="Items sold" value={fmt(summary?.items_sold)} detail="Across selected outlets" tip="Sum of quantity." /></section>
    <section className="chart-grid">
      <ChartPanel title="Outlet revenue ranking" subtitle="Revenue, order count, and average order value" className="span-two"><div className="chart-frame"><ResponsiveContainer width="100%" height={310}><BarChart data={outlets} margin={{ bottom: 28 }}><CartesianGrid vertical={false} stroke="#edf0eb" /><XAxis dataKey="outlet" interval={0} angle={-15} textAnchor="end" height={56} tickLine={false} axisLine={false} /><YAxis tickFormatter={fmt} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="revenue" name="Revenue" fill="#1f6955" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>{!outlets.length && <Empty />}</div></ChartPanel>
      <ChartPanel title="Compare outlets" subtitle="Select two locations to compare"><div className="comparison-controls">{[0, 1].map((index) => <label key={index}>Outlet {index + 1}<select value={compareOutlets[index]} onChange={(event) => setChoice(index, event.target.value)}><option value="">Select outlet</option>{meta.outlets.map((outlet) => <option key={outlet}>{outlet}</option>)}</select></label>)}</div><SimpleTable headings={['Outlet', 'Revenue', 'Orders', 'AOV', 'Items']} rows={selected.map((row) => [row.outlet, fmt(row.revenue), fmt(row.orders), fmtDecimal(row.aov), fmt(row.items_sold)])} empty="Choose outlets above to compare." /></ChartPanel>
      <ChartPanel title="Outlet metrics" subtitle="Ranked performance details"><SimpleTable headings={['Rank', 'Outlet', 'Revenue', 'Orders', 'AOV', 'Items']} rows={outlets.map((row, index) => [index + 1, row.outlet, fmt(row.revenue), fmt(row.orders), fmtDecimal(row.aov), fmt(row.items_sold)])} /></ChartPanel>
    </section>
  </>;
}

function Orders({ analytics, loading }) {
  if (loading && !analytics) return <Skeleton />;
  return <>
    <section className="chart-grid">
      <ChartPanel title="Order type" subtitle="Revenue share and order volume"><SimpleTable headings={['Order type', 'Revenue', 'Orders', 'AOV']} rows={(analytics?.orderTypes || []).map((row) => [row.name, fmt(row.revenue), fmt(row.orders), fmtDecimal(row.aov)])} /></ChartPanel>
      <ChartPanel title="Settlement methods" subtitle="Revenue and distinct bills"><Donut rows={analytics?.settlements} valueKey="revenue" nameKey="name" /></ChartPanel>
      <ChartPanel title="Hourly order distribution" subtitle="Distinct bills by hour"><div className="chart-frame"><ResponsiveContainer width="100%" height={280}><BarChart data={analytics?.hours || []}><CartesianGrid vertical={false} stroke="#edf0eb" /><XAxis dataKey="hour" tickFormatter={(value) => `${String(value).padStart(2, '0')}:00`} tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="orders" name="Orders" fill="#1f6955" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>{!analytics?.hours?.length && <Empty />}</div></ChartPanel>
      <ChartPanel title="Weekday performance" subtitle="Revenue and orders by weekday"><div className="chart-frame"><ResponsiveContainer width="100%" height={280}><ComposedChart data={analytics?.weekdays || []}><CartesianGrid vertical={false} stroke="#edf0eb" /><XAxis dataKey="weekday" tickLine={false} axisLine={false} /><YAxis yAxisId="revenue" tickFormatter={fmt} tickLine={false} axisLine={false} /><YAxis yAxisId="orders" orientation="right" hide /><Tooltip content={<ChartTooltip />} /><Legend /><Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#e8b17f" radius={[4, 4, 0, 0]} /><Line yAxisId="revenue" dataKey="revenue" name="Revenue" stroke="#1f6955" strokeWidth={2} /></ComposedChart></ResponsiveContainer>{!analytics?.weekdays?.length && <Empty />}</div></ChartPanel>
    </section>
  </>;
}

function Explorer({ result, search, setSearch, page, setPage, pageSize, setPageSize, sort, setSort, direction, setDirection, filters }) {
  const exportUrl = `/api/transactions.csv?${queryString({ ...filters, search })}`;
  const rows = result?.rows || [];
  return <section className="panel explorer-panel">
    <div className="explorer-toolbar"><div><h2>Transaction explorer</h2><p>Search and page through the filtered line-item ledger.</p></div><a className="export-button" href={exportUrl} download>Export filtered CSV</a></div>
    <div className="table-controls"><label>Search bill or item<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. 10124 or Classic Fries" /></label><label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="date">Order date</option><option value="billNo">Bill number</option><option value="outlet">Outlet</option><option value="item">Item</option><option value="revenue">Line revenue</option><option value="quantity">Quantity</option></select></label><label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label><label>Rows per page<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option></select></label></div>
    <div className="table-scroll transaction-scroll"><table><thead><tr><th>BillNo</th><th>Order_Datetime</th><th>Outlet_Name</th><th>Brand</th><th>Group</th><th>Item</th><th>Price</th><th>Quantity</th><th>Line revenue</th><th>Order_Type</th><th>Settlement</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.billNo}-${row.item}-${index}`}><td>{row.billNo}</td><td>{new Date(row.orderDatetime).toLocaleString('en-IN')}</td><td>{row.outlet}</td><td>{row.brand}</td><td>{row.category}</td><td>{row.item}</td><td>{fmtDecimal(row.price)}</td><td>{fmt(row.quantity)}</td><td>{fmt(row.revenue)}</td><td>{row.orderType}</td><td>{row.settlement}</td></tr>)}</tbody></table>{result && !rows.length && <Empty />}</div>
    <div className="pagination"><span>{result ? `${fmt(result.total)} matching rows · page ${result.page} of ${Math.max(1, result.totalPages)}` : 'Loading transactions…'}</span><div><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button disabled={!result || page >= result.totalPages} onClick={() => setPage(page + 1)}>Next</button></div></div>
  </section>;
}

function Quality({ quality, loading }) {
  if (loading && !quality) return <Skeleton />;
  if (!quality) return <Empty />;
  return <>
    <div className="section-intro"><div><h2>Processing health</h2><p>Validation summary for the ingested workbook and cleaned analytical dataset.</p></div><span className={`status-pill ${quality.rejected_records ? 'warning' : 'healthy'}`}><span className="health-dot" />{quality.rejected_records ? 'Review required' : 'Healthy dataset'}</span></div>
    <section className="metric-grid quality-grid"><Metric label="Records ingested" value={fmt(quality.ingested_records)} detail="Source workbook rows" tip="Rows read from the source workbook." /><Metric label="Successfully processed" value={fmt(quality.processed_records)} detail="Available to analytics" tip="Records written to the cleaned Parquet dataset." /><Metric label="Rejected records" value={fmt(quality.rejected_records)} detail="Documented by ETL" tip="Records rejected for missing required values or invalid dates/numbers." /><Metric label="Missing values" value={fmt(quality.missing_values)} detail="Across processed fields" tip="Null values found in the processed dataset." /><Metric label="Invalid dates" value={fmt(quality.invalid_dates)} detail="Processed dataset" tip="Invalid or missing order timestamps in processed rows." /><Metric label="Invalid numeric values" value={fmt(quality.invalid_numeric_values)} detail="Price or quantity" tip="Non-finite values in processed numeric fields." /><Metric label="Duplicate candidates" value={fmt(quality.duplicate_candidates)} detail="Exact source rows" tip="Exact duplicate source rows are reported, not silently removed." /><Metric label="Unique orders" value={fmt(quality.unique_orders)} detail="Distinct BillNo" tip="Distinct bills represented in the processed records." /><Metric label="Unique outlets" value={fmt(quality.unique_outlets)} detail="Outlet names" tip="Distinct outlet names in processed records." /><Metric label="Unique products" value={fmt(quality.unique_products)} detail="Menu items" tip="Distinct item names in processed records." /></section>
    <section className="chart-grid"><article className="panel"><h2>Dataset date range</h2><p className="date-range">{quality.data_range?.start?.slice(0, 10)} <span>→</span> {quality.data_range?.end?.slice(0, 10)}</p><p className="muted-copy">Last processing run: {quality.last_processed_at ? new Date(quality.last_processed_at).toLocaleString('en-IN') : 'Not recorded'}</p><p className="muted-copy">ETL processing time: {quality.processing_time_ms == null ? 'Not recorded' : `${fmtDecimal(quality.processing_time_ms / 1000)} seconds`}</p></article><article className="panel"><h2>Cleaning and validation rules</h2><ul className="rules-list">{quality.rules?.map((rule) => <li key={rule}>{rule}</li>)}</ul></article></section>
    {quality.rejected_records > 0 && <div className="warning-banner">{fmt(quality.rejected_records)} source records were rejected. Review the ETL report before interpreting totals.</div>}
  </>;
}

function Insights({ insights, loading }) {
  if (loading && !insights) return <Skeleton />;
  const categories = ['Revenue opportunities', 'Product performance', 'Outlet performance', 'Customer ordering patterns', 'Operational observations', 'Anomalies'];
  return <div className="insights-layout">{categories.map((category) => {
    const rows = (insights || []).filter((insight) => insight.category === category);
    if (!rows.length) return null;
    return <section className="insight-group" key={category}><div className="section-intro"><div><h2>{category}</h2><p>Deterministic findings derived from the active filters.</p></div></div><div className="insight-grid">{rows.map((insight) => <article className="insight-card" key={insight.title}><span className="insight-category">{insight.category}</span><h3>{insight.title}</h3><p className="insight-finding">{insight.finding}</p><div className="insight-metric"><span>Supporting metric</span><b>{typeof insight.metric === 'number' ? fmtDecimal(insight.metric) : insight.metric}</b></div><small>Period: {insight.period}</small><div className="insight-note"><b>Business implication</b><p>{insight.implication}</p></div><div className="insight-note"><b>Suggested action</b><p>{insight.action}</p></div></article>)}</div></section>;
  })}{!insights?.length && <Empty />}</div>;
}

function Donut({ rows = [], valueKey, nameKey }) {
  const valid = rows.filter((row) => Number(row[valueKey]) > 0);
  const total = valid.reduce((sum, row) => sum + Number(row[valueKey]), 0);
  return <div className="donut-wrap"><div className="donut-chart"><ResponsiveContainer width="100%" height={230}><PieChart><Pie data={valid} dataKey={valueKey} nameKey={nameKey} innerRadius={62} outerRadius={88} paddingAngle={2} stroke="white" strokeWidth={2}>{valid.map((row, index) => <Cell key={row[nameKey]} fill={colors[index % colors.length]} />)}</Pie><Tooltip formatter={(value, name) => [fmt(value), name]} /></PieChart></ResponsiveContainer><div className="donut-total"><b>{fmt(total)}</b><small>Total revenue</small></div></div><div className="donut-legend">{valid.map((row, index) => <div key={row[nameKey]}><i style={{ background: colors[index % colors.length] }} /><span>{row[nameKey]}</span><b>{total ? `${(Number(row[valueKey]) / total * 100).toFixed(1)}%` : '0%'}</b></div>)}{!valid.length && <Empty />}</div></div>;
}

function RankedBars({ rows, labelKey, valueKey }) {
  return <div className="chart-frame"><ResponsiveContainer width="100%" height={300}><BarChart data={rows} layout="vertical" margin={{ left: 12, right: 12 }}><CartesianGrid horizontal={false} stroke="#edf0eb" /><XAxis type="number" tickFormatter={fmt} tickLine={false} axisLine={false} /><YAxis type="category" dataKey={labelKey} width={130} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey={valueKey} name={valueKey === 'quantity' ? 'Units sold' : 'Revenue'} fill="#1f6955" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer>{!rows.length && <Empty />}</div>;
}

function Rank({ index, label, value }) {
  return <div className="rank-row"><span className="rank-number">{String(index + 1).padStart(2, '0')}</span><span className="rank-name">{label}</span><b>{fmt(value)}</b></div>;
}

function SimpleTable({ headings, rows = [], empty = 'No records match the selected filters.' }) {
  return <div className="table-scroll"><table><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>{!rows.length && <Empty text={empty} />}</div>;
}

function Skeleton() {
  return <div className="skeleton-grid" aria-label="Loading analytics">{Array.from({ length: 5 }, (_, index) => <div className="skeleton-card" key={index} />)}</div>;
}

export default App;
