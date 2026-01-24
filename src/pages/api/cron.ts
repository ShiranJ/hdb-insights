import type { APIRoute } from 'astro';
import { extractLeaseYears, calculatePricePerSqm } from '../../lib/db';
import { calculateTotalScore } from '../../lib/scoring';

export const prerender = false;

const HDB_API_URL = 'https://data.gov.sg/api/action/datastore_search';
const RESOURCE_ID = 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc';

interface HDBRecord {
    month: string;
    town: string;
    flat_type: string;
    block: string;
    street_name: string;
    storey_range: string;
    floor_area_sqm: string;
    flat_model: string;
    lease_commence_date: string;
    remaining_lease: string;
    resale_price: string;
}

/**
 * Cron handler for daily HDB data sync
 * Called automatically by Cloudflare cron trigger at 2 AM SGT
 */
export const GET: APIRoute = async ({ request, locals }) => {
    // Check for cron trigger or manual trigger with secret
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret');
    const isCron = request.headers.get('cf-cron') === 'true';

    // Validate access (either cron trigger or secret for manual testing)
    if (!isCron && secret !== 'manual-sync-trigger') {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const runtime = locals.runtime;
    if (!runtime?.env?.DB) {
        return new Response(
            JSON.stringify({ error: 'Database not configured. Make sure D1 binding is set up correctly.' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const DB = runtime.env.DB;
    const startTime = Date.now();

    try {
        // Update sync status
        await DB.prepare(`
      UPDATE sync_metadata 
      SET status = 'running', last_sync_at = ?
      WHERE sync_type = 'hdb_data'
    `).bind(new Date().toISOString()).run();

        // OPTIMIZATION: Get the latest month in our DB to avoid fetching old data
        const lastMonthResult = await DB.prepare('SELECT MAX(month) as max_month FROM hdb_transactions').first();
        const lastDbMonth = lastMonthResult?.max_month as string;

        // Default to 6 months ago if DB is empty
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        let filterDate = sixMonthsAgo.toISOString().substring(0, 7);

        // If we have data, we only need to sync the latest month and forward
        // (Because HDB releases data monthly/daily for current month)
        if (lastDbMonth && lastDbMonth > filterDate) {
            filterDate = lastDbMonth;
        }

        console.log(`Starting sync from month: ${filterDate}`);

        let allRecords: HDBRecord[] = [];
        let offset = 0;
        const limit = 1000;
        let totalProcessed = 0;
        const maxPages = 50; // Safety cap to prevent 190+ requests

        while (offset < 200000) { // Safety limit
            // OPTIMIZATION: Sort by month desc to get the newest records first. 
            const apiUrl = `${HDB_API_URL}?resource_id=${RESOURCE_ID}&limit=${limit}&offset=${offset}&sort=month%20desc`;

            console.log(`Fetching from: ${apiUrl}`);

            const response = await fetch(apiUrl);
            if (!response.ok) {
                if (response.status === 429) {
                    console.error('Rate limited. Stopping for this run.');
                    break;
                }
                throw new Error(`HDB API returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json() as { success: boolean; result: { records: HDBRecord[], total: number } };

            if (data.success && data.result.records.length > 0) {
                const records = data.result.records;
                const newestInBatch = records[0].month;
                const oldestInBatch = records[records.length - 1].month;

                console.log(`Batch Month Range: ${oldestInBatch} to ${newestInBatch}`);

                // Filter records >= filterDate
                const filtered = records.filter(
                    (r: HDBRecord) => r.month >= filterDate
                );

                if (filtered.length > 0) {
                    allRecords.push(...filtered);
                }

                console.log(`Found ${filtered.length} relevant records in batch. Total relevant: ${allRecords.length}`);

                // OPTIMIZATION: If even the NEWEST record in this batch is older than our filter, 
                // and we are sorted DESC, then we've reached the end of the interesting data.
                if (newestInBatch < filterDate) {
                    console.log(`Stopping sync: Newest record in batch (${newestInBatch}) is older than start date (${filterDate})`);
                    break;
                }

                if (records.length < limit) break;

                offset += limit;

                // If we've processed many records and found 0 relevant ones in the last few batches, stop.
                if (allRecords.length === 0 && offset > 5000) {
                    console.log('Stopping sync: No relevant records found in first 5000 records.');
                    break;
                }

                if (offset / limit >= maxPages) {
                    console.log('Safety cap reached (50 pages). Stopping sync.');
                    break;
                }

                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                break;
            }
        }

        console.log(`Total fetched: ${allRecords.length} records from HDB API (since ${filterDate})`);

        // Batch insert records
        let insertedCount = 0;
        if (allRecords.length > 0) {
            const batchSize = 50;

            for (let i = 0; i < allRecords.length; i += batchSize) {
                const batch = allRecords.slice(i, i + batchSize);

                const statements = batch.map(record => {
                    const price = parseInt(record.resale_price);
                    const area = parseFloat(record.floor_area_sqm);
                    const pricePerSqm = calculatePricePerSqm(price, area);
                    const remainingYears = extractLeaseYears(record.remaining_lease);

                    return DB.prepare(`
              INSERT OR IGNORE INTO hdb_transactions (
                transaction_date, month, town, flat_type, block, street_name,
                storey_range, floor_area_sqm, flat_model, lease_commence_date,
                remaining_lease, remaining_lease_years, resale_price, price_per_sqm
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                        `${record.month}-01`,
                        record.month,
                        record.town,
                        record.flat_type,
                        record.block,
                        record.street_name,
                        record.storey_range,
                        area,
                        record.flat_model,
                        parseInt(record.lease_commence_date),
                        record.remaining_lease,
                        remainingYears,
                        price,
                        pricePerSqm
                    );
                });

                const results = await DB.batch(statements);
                const batchInserted = results.filter(r => r.meta.changes > 0).length;
                insertedCount += batchInserted;

                if (batchInserted > 0) {
                    console.log(`Batch ${Math.floor(i / batchSize) + 1}: inserted ${batchInserted} records`);
                }
            }
        }

        // Update pre-aggregated statistics
        await updateStatistics(DB);

        // Populate unit scores (scoring)
        await populateUnitScores(DB, runtime.env);

        const duration = Date.now() - startTime;

        // Update sync status
        await DB.prepare(`
      UPDATE sync_metadata 
      SET status = 'completed', records_processed = ?, error_message = NULL
      WHERE sync_type = 'hdb_data'
    `).bind(insertedCount).run();

        return new Response(
            JSON.stringify({
                success: true,
                records_fetched: allRecords.length,
                records_inserted: insertedCount,
                duration_ms: duration
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Cron sync error:', error);

        // Try to update sync status if DB is available
        try {
            await DB.prepare(`
          UPDATE sync_metadata 
          SET status = 'failed', error_message = ?
          WHERE sync_type = 'hdb_data'
        `).bind(String(error)).run();
        } catch (dbError) {
            console.error('Failed to update sync status:', dbError);
        }

        return new Response(
            JSON.stringify({ error: 'Sync failed', details: String(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};

/**
 * Update pre-aggregated price statistics
 */
async function updateStatistics(DB: D1Database): Promise<void> {
    // Get distinct town/flat_type/month combinations that need updating
    await DB.prepare(`
    INSERT OR REPLACE INTO price_statistics (
      town, flat_type, month,
      median_price, avg_price, min_price, max_price,
      transaction_count, avg_price_per_sqm, updated_at
    )
    SELECT 
      town,
      flat_type,
      month,
      ROUND(AVG(resale_price)) as median_price, 
      ROUND(AVG(resale_price)) as avg_price,
      MIN(resale_price) as min_price,
      MAX(resale_price) as max_price,
      COUNT(*) as transaction_count,
      ROUND(AVG(price_per_sqm), 2) as avg_price_per_sqm,
      CURRENT_TIMESTAMP
    FROM hdb_transactions
    WHERE month >= date('now', '-6 months')
    GROUP BY town, flat_type, month
  `).run();
}

import {
    getCoordinates,
    getOneMapToken,
    getNearestMRT,
    getNearbyAmenities
} from '../../lib/onemap';

/**
 * Populate unit scores based on recent transactions with real OneMap data
 */
async function populateUnitScores(DB: D1Database, env: any): Promise<void> {
    console.log('Populating unit scores with OneMap data...');

    const ONEMAP_EMAIL = env.ONEMAP_EMAIL;
    const ONEMAP_PASSWORD = env.ONEMAP_PASSWORD;

    if (!ONEMAP_EMAIL || !ONEMAP_PASSWORD) {
        console.warn('OneMap credentials missing. Skipping enrichment.');
        return;
    }

    // 1. Get OneMap Token
    const token = await getOneMapToken(ONEMAP_EMAIL, ONEMAP_PASSWORD);
    if (!token) {
        console.error('Failed to get OneMap token. Skipping enrichment.');
        return;
    }

    // 2. Get latest town median prices
    const statsResult = await DB.prepare(`
        SELECT town, flat_type, median_price 
        FROM price_statistics
        WHERE month = (SELECT MAX(month) FROM price_statistics)
    `).all();

    const medianMap = new Map<string, number>();
    statsResult.results.forEach((row: any) => {
        medianMap.set(`${row.town}:${row.flat_type}`, row.median_price);
    });

    // 3. Get distinct blocks that need scoring
    // We fetch blocks from recent transactions that DON'T have a recent score
    const recentTxns = await DB.prepare(`
        SELECT t.* 
        FROM hdb_transactions t
        INNER JOIN (
            SELECT block, street_name, MAX(transaction_date) as max_date
            FROM hdb_transactions
            GROUP BY block, street_name
        ) latest ON t.block = latest.block 
               AND t.street_name = latest.street_name 
               AND t.transaction_date = latest.max_date
        LEFT JOIN unit_scores s ON t.block = s.block AND t.street_name = s.street_name
        WHERE s.total_score IS NULL OR s.calculated_at < date('now', '-30 days')
        LIMIT 200 -- Increased from 50 since we parallelized requests
    `).all();

    console.log(`Enriching ${recentTxns.results.length} blocks...`);

    // 4. Enrich and Calculate scores
    for (const txn of recentTxns.results as any[]) {
        try {
            // Check if we already have coordinates in transactions table (if we decide to cache them there)
            // For now, we fetch from OneMap
            const coords = await getCoordinates(txn.block, txn.street_name);
            if (!coords) {
                console.warn(`Could not geocode address: ${txn.block} ${txn.street_name}`);
                continue;
            }

            // Get MRT and Amenities in parallel to speed up processing
            const [mrt, schools, malls, parks, hawkers] = await Promise.all([
                getNearestMRT(coords.latitude, coords.longitude, token),
                getNearbyAmenities(coords.latitude, coords.longitude, 'preschools', token),
                getNearbyAmenities(coords.latitude, coords.longitude, 'shopping_malls', token),
                getNearbyAmenities(coords.latitude, coords.longitude, 'national_parks', token),
                getNearbyAmenities(coords.latitude, coords.longitude, 'hawkercentre', token)
            ]);

            const townMedian = medianMap.get(`${txn.town}:${txn.flat_type}`) || 0;

            const unitData = {
                resale_price: txn.resale_price,
                town_median: townMedian,
                mrt_distance: mrt ? mrt.distance : 1500, // Default to far if none found
                remaining_lease_years: txn.remaining_lease_years || 95,
                price_history: [], // Still no history for now
                amenities: {
                    schools,
                    malls,
                    parks,
                    hawkers
                }
            };

            const score = calculateTotalScore(unitData);

            await DB.prepare(`
                INSERT OR REPLACE INTO unit_scores (
                    block, street_name, town, flat_type,
                    total_score, price_score, location_score, lease_score, appreciation_score, amenities_score,
                    mrt_distance, nearest_mrt, nearby_schools, nearby_malls, nearby_parks,
                    calculated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).bind(
                txn.block, txn.street_name, txn.town, txn.flat_type,
                score.total_score, score.price_score, score.location_score, score.lease_score, score.appreciation_score, score.amenities_score,
                unitData.mrt_distance, mrt ? mrt.name : 'None nearby',
                schools, malls, parks
            ).run();

            // Also update transactions table with lat/long if columns exist
            await DB.prepare(`
                UPDATE hdb_transactions 
                SET latitude = ?, longitude = ?
                WHERE block = ? AND street_name = ?
            `).bind(coords.latitude, coords.longitude, txn.block, txn.street_name).run();

            // Small delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 200));

        } catch (err) {
            console.error(`Error enriching block ${txn.block} ${txn.street_name}:`, err);
        }
    }

    console.log('Score population/enrichment complete.');
}

