# HDB Insights - Requirements Task List

**Last Updated**: 2026-01-31  
**Status**: In Progress  
**Completion**: 45% (Core features implemented, advanced features pending)

---

## 📊 Progress Overview

```
Phase 1 (Quick Wins):        [x] 4/4 tasks
Phase 2 (Data Quality):      [ ] 0/3 tasks
Phase 3 (Visualizations):    [ ] 0/3 tasks
Phase 4 (Advanced Scoring):  [ ] 0/2 tasks
Phase 5 (User Engagement):   [ ] 0/2 tasks

Total: 4/14 tasks completed
```

---

## 🟢 PHASE 1: Quick Wins (Week 1)
**Priority**: HIGH | **Effort**: ~15 hours

### [x] 1.1 Shareable Comparison Links
- **Effort**: 2-3 hours
- **Value**: ⭐⭐⭐⭐⭐
- **Difficulty**: EASY
- **Files**: `src/pages/compare.astro`, `src/pages/calculator.astro`, `src/pages/trends.astro`

**Tasks**:
- [x] Encode filter state in URL query parameters
- [x] Add "Share" button with copy-to-clipboard functionality
- [x] Parse URL params on page load to restore filter state
- [x] Test with different filter combinations
- [x] Add visual feedback when link is copied

**Acceptance Criteria**:
- ✅ URL contains all active filters as query params
- ✅ Pasting URL restores exact filter state
- ✅ Share button shows "Copied!" feedback
- ✅ Works on all 3 tool pages

---

### [x] 1.2 Additional Filters (Floor Area, Storey Range)
- **Effort**: 4-6 hours
- **Value**: ⭐⭐⭐⭐
- **Difficulty**: EASY
- **Files**: `src/pages/compare.astro`, `src/pages/calculator.astro`, `src/pages/api/comparison.ts`, `src/pages/api/calculator.ts`

**Tasks**:
- [x] Add floor area inputs (min/max sqm)
- [x] Add storey range dropdown/select
- [x] Update API endpoints to accept new filter params
- [x] Add SQL WHERE clauses for floor_area_sqm and storey_range
- [x] Test filter combinations
- [x] Update UI to show active filters

**Acceptance Criteria**:
- ✅ Floor area inputs filter results correctly
- ✅ Storey range selection works
- ✅ Filters persist in shareable URLs
- ✅ Results update in real-time

---

### [x] 1.3 Price Trend Indicators (QoQ/YoY)
- **Effort**: 3-4 hours
- **Value**: ⭐⭐⭐⭐
- **Difficulty**: EASY
- **Files**: `src/pages/api/comparison.ts`, `src/pages/compare.astro`

**Tasks**:
- [x] Calculate MoM price change in API
- [x] Calculate YoY price change in API
- [x] Add trend badge components to comparison cards
- [x] Color code: green (increase), red (decrease)
- [x] Display on comparison cards with period overview

**Acceptance Criteria**:
- ✅ Shows MoM and YoY trends clearly
- ✅ Calculations are mathematically robust
- ✅ Visually consistent with design system

---

### [x] 1.4 Last Updated Timestamp & Sync Status
- **Effort**: 2 hours
- **Value**: ⭐⭐⭐
- **Difficulty**: EASY
- **Files**: All tool pages, `src/pages/api/sync-status.ts`

**Tasks**:
- [x] Query `sync_metadata` table for last sync time
- [x] Display "Last updated: Xh ago" on all pages
- [x] Update refresh button to trigger manual sync via `/api/cron`
- [x] Show sync status toast and progress
- [x] Display "X new transactions" badge from latest sync

**Acceptance Criteria**:
- ✅ Timestamp shows relative time
- ✅ Manual sync button fully functional
- ✅ Real-time feedback for sync progress

---

## 🟡 PHASE 2: Core Data Improvements (Week 2-3)
**Priority**: CRITICAL | **Effort**: ~21 hours

### [ ] 2.1 Fix Median Price Calculation
- **Effort**: 6-8 hours
- **Value**: ⭐⭐⭐⭐⭐ CRITICAL
- **Difficulty**: MEDIUM
- **Files**: `src/pages/api/cron.ts`

**Tasks**:
- [ ] Research SQLite median calculation methods (window functions)
- [ ] Implement correct median calculation in `updateStatistics()`
- [ ] Test with sample data to verify accuracy
- [ ] Update existing statistics with correct medians
- [ ] Add unit tests for median calculation

**SQL Implementation**:
```sql
WITH ranked AS (
  SELECT 
    town, flat_type, month, resale_price,
    ROW_NUMBER() OVER (PARTITION BY town, flat_type, month ORDER BY resale_price) as rn,
    COUNT(*) OVER (PARTITION BY town, flat_type, month) as cnt
  FROM hdb_transactions
)
SELECT 
  town, flat_type, month,
  AVG(resale_price) as median_price
FROM ranked
WHERE rn IN (cnt/2, (cnt/2)+1)
GROUP BY town, flat_type, month;
```

**Acceptance Criteria**:
- ✅ Median calculation is mathematically correct
- ✅ All statistics updated with true medians
- ✅ Performance is acceptable (< 5 seconds)
- ✅ Verified against manual calculations

---

### [ ] 2.2 Calculate Price Change Percentages
- **Effort**: 4-5 hours
- **Value**: ⭐⭐⭐⭐
- **Difficulty**: MEDIUM
- **Files**: `src/pages/api/cron.ts`

**Tasks**:
- [ ] Add price change calculation after statistics update
- [ ] Calculate MoM change for each town/flat_type/month
- [ ] Store in `price_statistics.price_change_pct`
- [ ] Handle first month (no previous data)
- [ ] Test with historical data

**Acceptance Criteria**:
- ✅ `price_change_pct` populated for all records (except first month)
- ✅ Calculation is accurate
- ✅ Handles edge cases (division by zero, missing data)
- ✅ Updates automatically with new data

---

### [ ] 2.3 5-Year Historical Data Backfill
- **Effort**: 1-2 days
- **Value**: ⭐⭐⭐⭐⭐ CRITICAL
- **Difficulty**: MEDIUM-HIGH
- **Files**: `scripts/backfill-historical.ts`, `src/pages/api/cron.ts`

**Tasks**:
- [ ] Create backfill script (`scripts/backfill-historical.ts`)
- [ ] Fetch data from 2019-01-01 to 2024-01-01 (~5 years)
- [ ] Implement batch processing (avoid timeouts)
- [ ] Add progress logging
- [ ] Handle API rate limits (1 second delay)
- [ ] Insert into local D1 database
- [ ] Push to remote D1 database
- [ ] Update cron to only fetch recent data after backfill
- [ ] Verify data completeness

**Acceptance Criteria**:
- ✅ ~300,000 historical records in database
- ✅ Data spans from 2019-01-01 to present
- ✅ No duplicate records
- ✅ All derived fields calculated (price_per_sqm, remaining_lease_years)
- ✅ Script can be re-run safely (idempotent)

---

## 🟠 PHASE 3: Enhanced Visualizations (Week 4)
**Priority**: MEDIUM-HIGH | **Effort**: ~21 hours

### [ ] 3.1 Export Charts as PNG
- **Effort**: 6-8 hours
- **Value**: ⭐⭐⭐⭐
- **Difficulty**: MEDIUM
- **Files**: `src/pages/trends.astro`, `src/pages/compare.astro`, `package.json`

**Tasks**:
- [ ] Install `html2canvas` library
- [ ] Add "Download PNG" button to trend charts
- [ ] Add "Download PNG" button to comparison charts
- [ ] Implement chart capture and download
- [ ] Handle high-DPI displays (retina)
- [ ] Add loading state during capture
- [ ] Test on different browsers

**Acceptance Criteria**:
- ✅ PNG export works on all charts
- ✅ Image quality is high (2x resolution)
- ✅ Chart is fully rendered before capture
- ✅ Filename includes chart details (e.g., "hdb-trends-tampines-4room.png")

---

### [ ] 3.2 Forecast Visualization (6-month)
- **Effort**: 8-10 hours
- **Value**: ⭐⭐⭐⭐
- **Difficulty**: MEDIUM
- **Files**: `src/pages/api/trends.ts`, `src/pages/trends.astro`

**Tasks**:
- [ ] Implement linear regression function
- [ ] Calculate forecast for next 6 months
- [ ] Add forecast data to API response
- [ ] Display forecast as dashed line on chart
- [ ] Add disclaimer text ("Forecast is for informational purposes only")
- [ ] Add toggle to show/hide forecast
- [ ] Test accuracy with historical data

**Acceptance Criteria**:
- ✅ Forecast line extends 6 months into future
- ✅ Visually distinct from actual data (dashed line, different color)
- ✅ Disclaimer is prominent
- ✅ Can be toggled on/off

---

### [ ] 3.3 Transaction Volume Chart
- **Effort**: 4-5 hours
- **Value**: ⭐⭐⭐
- **Difficulty**: EASY-MEDIUM
- **Files**: `src/pages/trends.astro`, `src/pages/api/trends.ts`

**Tasks**:
- [ ] Add transaction count to trends API response
- [ ] Create area chart for volume
- [ ] Display below price chart or as dual-axis
- [ ] Add tooltip showing count
- [ ] Style appropriately

**Acceptance Criteria**:
- ✅ Volume chart shows transaction counts over time
- ✅ Visually clear and readable
- ✅ Synchronized with price chart (same time range)
- ✅ Helps identify market activity levels

---

## 🔴 PHASE 4: Advanced Scoring (Week 5-6)
**Priority**: CRITICAL | **Effort**: ~50 hours

### [ ] 4.1 Price History Aggregation
- **Effort**: 2-3 days
- **Value**: ⭐⭐⭐⭐⭐ CRITICAL
- **Difficulty**: HIGH
- **Files**: `schema.sql`, `src/pages/api/enrich.ts`, `src/lib/scoring.ts`

**Tasks**:
- [ ] Add `price_history_json TEXT` column to `unit_scores` table
- [ ] Create function to aggregate 3-year price history per unit
- [ ] Store price history as JSON array in database
- [ ] Update scoring algorithm to use stored price history
- [ ] Calculate appreciation scores for all units
- [ ] Test with various units (new, old, stable, volatile)
- [ ] Handle edge cases (< 3 years of data)

**SQL Query**:
```sql
SELECT month, AVG(resale_price) as avg_price
FROM hdb_transactions
WHERE block = ? AND street_name = ? AND flat_type = ?
  AND month >= date('now', '-3 years')
GROUP BY month
ORDER BY month ASC
```

**Acceptance Criteria**:
- ✅ Price history stored for all scored units
- ✅ Appreciation scores are accurate (not defaulting to 50)
- ✅ Performance is acceptable (< 1 second per unit)
- ✅ Handles units with insufficient data gracefully

---

### [ ] 4.2 OneMap Amenities Integration
- **Effort**: 3-4 days
- **Value**: ⭐⭐⭐⭐
- **Difficulty**: HIGH
- **Files**: `src/lib/onemap.ts`, `src/pages/api/enrich.ts`, `schema.sql`

**Tasks**:
- [ ] Add `nearby_hawkers INTEGER` to `unit_scores` table
- [ ] Implement OneMap Themes API client
- [ ] Add token refresh logic (tokens expire after 3 days)
- [ ] Fetch schools within 500m radius
- [ ] Fetch malls within 500m radius
- [ ] Fetch parks within 500m radius
- [ ] Research hawker centers alternative (if theme unavailable)
- [ ] Add rate limiting (500ms delay between requests)
- [ ] Update amenities scores for all units
- [ ] Handle API errors gracefully

**Acceptance Criteria**:
- ✅ Amenities data populated for all geocoded units
- ✅ Counts are accurate (verified with manual checks)
- ✅ Token refresh works automatically
- ✅ Rate limiting prevents API blocks
- ✅ Amenities scores reflect actual nearby amenities

---

## 🟣 PHASE 5: User Engagement (Week 7-8)
**Priority**: HIGH | **Effort**: ~44 hours

### [ ] 5.1 Alert System (Email)
- **Effort**: 4-5 days
- **Value**: ⭐⭐⭐⭐⭐
- **Difficulty**: HIGH
- **Files**: `src/pages/alerts.astro`, `src/pages/api/alerts/*.ts`, `src/pages/api/cron.ts`

**Tasks**:
- [ ] Create alert subscription form page
- [ ] Add Resend API integration
- [ ] Create `POST /api/alerts/subscribe` endpoint
- [ ] Create `POST /api/alerts/unsubscribe` endpoint
- [ ] Store preferences in `user_alerts` table
- [ ] Add alert checking logic to cron job
- [ ] Design email template
- [ ] Implement email sending
- [ ] Add unsubscribe link to emails
- [ ] Test email deliverability
- [ ] Add rate limiting (prevent spam)

**Acceptance Criteria**:
- ✅ Users can subscribe with email and preferences
- ✅ Alerts sent when matching units appear
- ✅ Email template is professional and clear
- ✅ Unsubscribe works immediately
- ✅ No duplicate emails sent
- ✅ Respects user preferences (min_score, towns, budget)

---

### [ ] 5.2 "Why This Score?" Explanations
- **Effort**: 1-2 days
- **Value**: ⭐⭐⭐
- **Difficulty**: MEDIUM
- **Files**: `src/lib/scoring.ts`, `src/pages/calculator.astro`

**Tasks**:
- [ ] Create explanation generator function
- [ ] Generate text for each score component
- [ ] Add positive/negative indicators
- [ ] Display explanations in calculator UI
- [ ] Add expandable details section
- [ ] Test with various score combinations

**Example Output**:
```
✅ Priced 15% below town median
✅ Only 250m from Tampines MRT
⚠️ 45 years remaining lease (below ideal)
✅ Strong 8% annual appreciation
✅ 2 schools and 1 mall nearby
```

**Acceptance Criteria**:
- ✅ Explanations are clear and actionable
- ✅ All 5 score components explained
- ✅ Uses natural language
- ✅ Highlights strengths and weaknesses

---

## 📈 Success Metrics

Track these KPIs to measure implementation success:

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Shareable link usage | 20% of users | 0% | ⏳ |
| Filter usage rate | 40% of users | - | ⏳ |
| Data accuracy (median) | 100% | ~90% | ⚠️ |
| Historical data coverage | 5 years | 6 months | ⚠️ |
| Units with complete scores | 80% | ~30% | ⚠️ |
| Chart exports per week | 50+ | 0 | ⏳ |
| Email subscribers | 100+ | 0 | ⏳ |
| Alert open rate | 30%+ | - | ⏳ |

---

## 🚫 Out of Scope (Not Worth Implementing)

These features have **low ROI** and should be skipped:

- ❌ SMS alerts (expensive, low engagement)
- ❌ Heatmap visualizations (complex, limited value)
- ❌ Embeddable iframe charts (low demand)
- ❌ PDF export (PNG is sufficient)
- ❌ Scatter plots (limited insight)
- ❌ Real-time data updates (daily is sufficient)

---

## 🔄 Maintenance Tasks

Ongoing tasks after implementation:

- [ ] Monitor API rate limits and adjust delays
- [ ] Check email deliverability monthly
- [ ] Review and update forecast accuracy
- [ ] Optimize slow queries (> 2 seconds)
- [ ] Update OneMap token before expiration
- [ ] Backup database weekly
- [ ] Monitor D1 storage usage

---

## 📝 Notes

- **5-year data is critical**: Blocks appreciation scoring and historical trends
- **Median fix is urgent**: Current data is misleading users
- **Start with Phase 1**: Quick wins build momentum
- **Amenities API is tricky**: Plan for rate limiting and token management
- **Alert system is high-value**: Drives retention and engagement

---

**Next Steps**: Start with Phase 1, Task 1.1 (Shareable Links)
