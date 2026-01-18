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

        // Fetch data from data.gov.sg (last 6 months to catch new records)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const filterDate = sixMonthsAgo.toISOString().substring(0, 7);

        let allRecords: HDBRecord[] = [];
        let offset = 0;
        const limit = 1000;

        while (true) {
            const apiUrl = `${HDB_API_URL}?resource_id=${RESOURCE_ID}&limit=${limit}&offset=${offset}`;

            console.log(`Fetching from: ${apiUrl}`);

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HDB API returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json() as { success: boolean; result: { records: HDBRecord[] } };

            if (data.success && data.result.records.length > 0) {
                // Filter records >= 6 months ago
                const filtered = data.result.records.filter(
                    (r: HDBRecord) => r.month >= filterDate
                );

                allRecords.push(...filtered);
                console.log(`Fetched ${data.result.records.length} records, ${filtered.length} after filtering. Total: ${allRecords.length}`);

                if (data.result.records.length < limit) {
                    break; // No more pages
                }

                offset += limit;

                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 600));
            } else {
                break;
            }
        }

        console.log(`Total fetched: ${allRecords.length} records from HDB API`);

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
                insertedCount += results.filter(r => r.meta.changes > 0).length;

                console.log(`Batch ${Math.floor(i / batchSize) + 1}: inserted ${results.filter(r => r.meta.changes > 0).length} records`);
            }
        }

        // Update pre-aggregated statistics
        await updateStatistics(DB);

        // Populate unit scores (scoring)
        await populateUnitScores(DB);

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

/**
 * Populate unit scores based on recent transactions
 */
async function populateUnitScores(DB: D1Database): Promise<void> {
    console.log('Populating unit scores...');

    // 1. Get latest town median prices (using most recent month)
    const statsResult = await DB.prepare(`
        SELECT town, flat_type, median_price 
        FROM price_statistics
        WHERE month = (SELECT MAX(month) FROM price_statistics)
    `).all();

    const medianMap = new Map<string, number>();
    statsResult.results.forEach((row: any) => {
        medianMap.set(`${row.town}:${row.flat_type}`, row.median_price);
    });

    // 2. Get distinct blocks with their latest transaction details
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
        LIMIT 500 -- Limit for performance in this demo
    `).all();

    // 3. Calculate scores and batch insert
    const statements = [];

    for (const txn of recentTxns.results as any[]) {
        const townMedian = medianMap.get(`${txn.town}:${txn.flat_type}`) || 0;

        // Mock data for missing geocoding
        const unitData = {
            resale_price: txn.resale_price,
            town_median: townMedian,
            mrt_distance: 500, // Default average
            remaining_lease_years: txn.remaining_lease_years || 95,
            price_history: [], // No history for simple calculation
            amenities: {
                schools: 1, // Default minimal
                malls: 1,
                parks: 1,
                hawkers: 1
            }
        };

        const score = calculateTotalScore(unitData);

        statements.push(DB.prepare(`
            INSERT OR REPLACE INTO unit_scores (
                block, street_name, town, flat_type,
                total_score, price_score, location_score, lease_score, appreciation_score, amenities_score,
                mrt_distance, nearby_schools, nearby_malls, nearby_parks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            txn.block, txn.street_name, txn.town, txn.flat_type,
            score.total_score, score.price_score, score.location_score, score.lease_score, score.appreciation_score, score.amenities_score,
            500, 1, 1, 1
        ));
    }

    if (statements.length > 0) {
        // Chunk sizes for batching
        const BATCH_SIZE = 10;
        for (let i = 0; i < statements.length; i += BATCH_SIZE) {
            await DB.batch(statements.slice(i, i + BATCH_SIZE));
        }
        console.log(`Populated ${statements.length} unit scores`);
    }
}
