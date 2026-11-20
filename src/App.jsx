import { useEffect, useState } from 'react';
import { BarChart, Bar, LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const api = (path) => fetch(path).then((r) => r.json());

export default function App() {
  const [meta, setMeta] = useState(null), [summary, setSummary] = useState(null), [monthly, setMonthly] = useState([]), [outlets, setOutlets] = useState([]);
  const [filters, setFilters] = useState({ start: '2025-06-17', end: '2026-06-16', outlet: '', orderType: '' });
  useEffect(() => { api('/api/metadata').then(setMeta); }, []);
  useEffect(() => { const q = new URLSearchParams(Object.entries(filters).filter(([,v]) => v)); Promise.all([api(`/api/summary?${q}`), api(`/api/monthly?${q}`), api(`/api/outlets?${q}`)]).then(([s,m,o]) => { setSummary(s); setMonthly(m); setOutlets(o); }); }, [filters]);
  if (!summary || !meta) return <main className="loading">Loading verified restaurant data…</main>;
  const change = monthly.length > 1 ? ((monthly.at(-1).revenue / monthly.at(-2).revenue - 1) * 100) : null;
  const top = outlets[0];
  return <main>
    <header><div><p className="eyebrow">{meta.brand} · Decision cockpit</p><h1>BurritoIQ</h1><p className="sub">From restaurant data to smarter decisions.</p></div><div className="trust">DATA TRUST<br/><b>{fmt(summary.records)} records</b> · 17 Jun 2025–16 Jun 2026</div></header>
    <section className="filters"><label>From<input type="date" value={filters.start} onChange={e=>setFilters({...filters,start:e.target.value})}/></label><label>To<input type="date" value={filters.end} onChange={e=>setFilters({...filters,end:e.target.value})}/></label><label>Outlet<select value={filters.outlet} onChange={e=>setFilters({...filters,outlet:e.target.value})}><option value="">All outlets</option>{meta.outlets.map(x=><option key={x}>{x}</option>)}</select></label><label>Order type<select value={filters.orderType} onChange={e=>setFilters({...filters,orderType:e.target.value})}><option value="">All order types</option>{meta.order_types.map(x=><option key={x}>{x}</option>)}</select></label><button onClick={()=>setFilters({start:'2025-06-17',end:'2026-06-16',outlet:'',orderType:''})}>Reset</button></section>
    <section className="kpis"><Card label="Revenue" value={fmt(summary.revenue)} /><Card label="Orders" value={fmt(summary.orders)} /><Card label="Items sold" value={fmt(summary.items_sold)} /><Card label="AOV" value={summary.aov.toFixed(2)} /></section>
    <section className="grid"><article className="panel wide"><h2>Revenue by month</h2><p>Partial June months are shaded in the data policy and excluded from month-over-month comparisons.</p><ResponsiveContainer width="100%" height={260}><LineChart data={monthly}><XAxis dataKey="month" tick={{fontSize:11}}/><YAxis tickFormatter={fmt}/><Tooltip formatter={fmt}/><Line type="monotone" dataKey="revenue" stroke="#ef6c36" strokeWidth={3} dot={false}/></LineChart></ResponsiveContainer></article><article className="panel"><h2>Outlet performance</h2><ResponsiveContainer width="100%" height={260}><BarChart data={outlets}><XAxis dataKey="outlet" tick={{fontSize:10}} interval={0}/><YAxis hide/><Tooltip formatter={fmt}/><Bar dataKey="revenue" fill="#143d37" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></article></section>
    <section className="grid"><article className="panel"><h2>What the data shows</h2><p>{top ? <><b>{top.outlet}</b> is the highest-revenue outlet in this view, with {fmt(top.revenue)} revenue from {fmt(top.orders)} orders.</> : 'No records match these filters.'}</p><p>{change === null || monthly.at(-1)?.partial ? 'A comparable latest-period change is unavailable because the final month is partial.' : `Latest full-month revenue changed ${change.toFixed(1)}% from the preceding full month.`}</p></article><article className="panel"><h2>Worth considering</h2><p>Use outlet and order-type filters to identify whether the observed mix is consistent across locations. The data does not identify causes or staffing requirements.</p><p>Free items remain in item counts but are excluded from average selling price.</p></article></section>
    <footer>Revenue has no currency symbol because the source data does not specify one. Brand is a fixed label because every record is {meta.brand}.</footer>
  </main>;
}
function Card({label,value}) { return <article className="card"><span>{label}</span><strong>{value}</strong></article>; }
