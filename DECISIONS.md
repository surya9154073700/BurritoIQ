# BurritoIQ technical decisions

## Data storage and serving

We use a reproducible one-time ETL: Excel -> validated rows -> Parquet, queried read-only by DuckDB through an Express API. The Excel file is never read at runtime. This is faster for analytical aggregations than reading a workbook per request, requires no database server, and keeps deployment small.

Alternatives considered:

- Reading Excel on each request: simple but too slow for interactive filtering.
- Postgres/MySQL/SQLite/MongoDB: appropriate for concurrent writes or live operational ingestion, but unnecessary for this static assessment dataset.
- In-memory dataframes: workable for a demo but less durable and less queryable than Parquet + DuckDB.

Trade-offs: data is read-only; refreshing it requires rerunning ETL; response caching is per application instance.

## Approved data policies

- No deduplication: ETL checks and reports exact duplicate rows but preserves all source rows. This file's audit found 0 exact duplicates.
- `BillNo` is stored as a display string (without Excel's `.0`) and a numeric sort key. It is never used as a time proxy.
- Excel serial timestamps are converted using the 1900 date system. The default dashboard range is the dataset range: 2025-06-17 to 2026-06-16.
- Zero-price lines are retained and flagged `is_free_item`; they count toward items sold but are excluded from average selling price.
- Revenue is `Price * Quantity`; orders are distinct `BillNo`; AOV is revenue / orders.
- Currency is unspecified. The product never displays a currency symbol and labels the metric `Revenue`.
- June 2025 and June 2026 are partial months. Monthly views flag them and exclude them from month-over-month comparisons. Year-over-year is unavailable because the data covers only one year.
- Brand has one value, Burger Town. It is shown as context but is not a filter or comparison.
- The dataset has no region or status field. Filters are date range, Outlet, Group, Item, Order Type, and Settlement.
- Insight copy must be calculated from the filtered data. No causal claims or fabricated anomalies are allowed.
- Raw Excel remains untracked (`data/raw/` and `*.xlsx`). Cleaned Parquet is intentionally committed so the deployed application can run without the source workbook.
