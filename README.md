# BurritoIQ

Decision cockpit for restaurant sales data. It uses an Express API and DuckDB to query a cleaned Parquet file, with a React/Vite client.

## Run locally

1. Put the source workbook at `data/raw/data.xlsx` (or pass a path to the ETL command).
2. `npm install`
3. `npm run etl -- --source data.xlsx` (the supplied local workbook currently lives at the project root)
4. `npm run dev`

The API runs on port 10000 and the Vite UI on port 5175. The Vite dev server proxies `/api` and `/health` to the API; set `VITE_API_PROXY_TARGET` if the API runs on a different host or port. In production, the frontend and API are served from the same origin.

## Data policy

The raw workbook is intentionally ignored by Git. `data/processed/cleaned.parquet` is committed so deployments can query the supplied cleaned data without shipping the raw Excel source. Currency is unspecified by the dataset, so the product shows `Revenue` without a symbol.

## Metrics

- Orders: distinct `BillNo`
- Revenue: sum of `Price * Quantity`
- Items sold: sum of `Quantity`, including free items
- AOV: revenue / orders
- Average selling price: revenue / quantities on non-free lines only
