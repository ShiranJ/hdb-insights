# HDB Insights: Core Tools Suite

A modern, high-performance web suite built with Astro and Cloudflare to analyze Singapore's HDB resale market. This suite provides real-time data analysis, value scoring, and historical trend visualizations using free Singapore government APIs.

## 🚀 Key Features

1.  **Interactive Price Comparison Tool**: Compare HDB resale prices across estates, flat types, and time periods with multi-dimensional filters. Includes QoQ trends, CSV/PNG export, and shareable links.
2.  **Value Score Calculator**: An automated multi-factor scoring system for HDB units based on price, location (MRT proximity), lease, and amenities.
3.  **Historical Trend Charts**: Interactive time-series visualizations with moving averages and price change indicators.

## 🛠 Tech Stack

- **Framework**: Astro (Static & SSR)
- **Deployment**: Cloudflare Pages / Workers
- **Database**: Cloudflare D1 (SQLite)
- **Cache**: Cloudflare KV
- **APIs**:
    - [Data.gov.sg](https://data.gov.sg/api/action/datastore_search?resource_id=d_8b84c4ee58e3cfc0ece0d773c8ca6abc) (HDB Resale Prices)
    - [OneMap.gov.sg](https://www.onemap.gov.sg/docs/) (Geocoding, Transport, Amenities)
- **Visuals**: Chart.js / Vanilla CSS

## � Getting Started

### Prerequisites
- Node.js & npm
- Cloudflare Account
- OneMap Developer Account (Free)

### Installation
```bash
git clone <repo-url>
cd hdb-insights
npm install
```

### Environment Setup
Update `wrangler.json` (or use `wrangler secret put`) with your OneMap credentials:
```json
"vars": {
  "ONEMAP_EMAIL": "your-email@example.com",
  "ONEMAP_PASSWORD": "your-password"
}
```

## 🚢 Deployment

1.  **Create D1 Database**:
    ```bash
    npx wrangler d1 create hdb-data
    ```
    Update the `database_id` in `wrangler.json` with the assigned ID.

2.  **Run Schema Migrations**:
    ```bash
    npx wrangler d1 execute hdb-data --local --file=./schema.sql
    npx wrangler d1 execute hdb-data --remote --file=./schema.sql
    ```

3.  **Create KV Namespace**:
    ```bash
    npx wrangler kv:namespace create HDB_CACHE
    ```
    Update the `kv_namespaces` binding in `wrangler.json` with the assigned ID.

4.  **Deploy**:
    ```bash
    npm run build && npx wrangler pages deploy ./dist
    ```

## 🔄 Data Synchronization

The application includes an automated data sync pipeline via `/api/cron`.

### Automated Sync
Daily synchronization is configured via Cloudflare Cron Triggers in `wrangler.json`:
```json
"triggers": {
  "crons": ["0 18 * * *"]
}
```
*Note: This runs daily at 2 AM SGT.*

### Manual Sync Trigger
You can manually trigger a data sync (fetches latest Data.gov.sg records and enriches with OneMap) by visiting:
```text
https://your-domain.com/api/cron?secret=manual-sync-trigger
```
### Sync Status
Check the status of the latest sync and transaction count via:
```text
https://your-domain.com/api/sync-status
```

## 🧞 Local Development
```bash
npm run dev
```
To test with a local D1 database:
```bash
npx wrangler d1 execute hdb-data --local --file=./schema.sql
npm run build && npx wrangler dev
```

## 📝 License
MIT
