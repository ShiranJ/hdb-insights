import type { APIRoute } from 'astro';
import {
    getCoordinates,
    getOneMapToken,
    getNearestMRT,
    getNearbyAmenities
} from '../../lib/onemap';
import { calculateTotalScore } from '../../lib/scoring';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
    // 1. Security Check
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret');
    const isCron = request.headers.get('cf-cron') === 'true';

    if (!isCron && secret !== 'manual-sync-trigger') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const runtime = locals.runtime;
    if (!runtime?.env?.DB) {
        return new Response('No DB', { status: 500 });
    }
    const DB = runtime.env.DB;
    const env = runtime.env;

    const ONEMAP_EMAIL = env.ONEMAP_EMAIL;
    const ONEMAP_PASSWORD = env.ONEMAP_PASSWORD;

    if (!ONEMAP_EMAIL || !ONEMAP_PASSWORD) {
        return new Response('OneMap credentials missing', { status: 500 });
    }

    const startTime = Date.now();
    console.log('Starting chunked enrichment...');

    const token = await getOneMapToken(ONEMAP_EMAIL as string, ONEMAP_PASSWORD as string);
    if (!token) {
        return new Response('Failed to get OneMap token', { status: 500 });
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

    // 3. Get blocks to enrich (Chunk size: 5 to stay safe within subrequest limits for Free plan)
    // We only pick blocks that haven't been enriched recently or at all.
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
        LIMIT 5
    `).all();

    console.log(`Processing ${recentTxns.results.length} blocks in this chunk...`);

    const results = [];

    // 4. Enrichment Loop
    for (const txn of recentTxns.results as any[]) {
        try {
            const coords = await getCoordinates(txn.block, txn.street_name);
            if (!coords) {
                console.warn(`(warn) Could not geocode address: ${txn.block} ${txn.street_name}`);
                continue;
            }

            // Fetch amenities sequentially with small delays to avoid hammering OneMap too hard
            const mrt = await getNearestMRT(coords.latitude, coords.longitude, token);
            await new Promise(resolve => setTimeout(resolve, 100));

            const schools = await getNearbyAmenities(coords.latitude, coords.longitude, 'preschools', token);
            await new Promise(resolve => setTimeout(resolve, 100));

            const malls = await getNearbyAmenities(coords.latitude, coords.longitude, 'shopping_malls', token);
            await new Promise(resolve => setTimeout(resolve, 100));

            const parks = await getNearbyAmenities(coords.latitude, coords.longitude, 'national_parks', token);
            await new Promise(resolve => setTimeout(resolve, 100));

            const hawkers = await getNearbyAmenities(coords.latitude, coords.longitude, 'hawkercentre', token);

            const townMedian = medianMap.get(`${txn.town}:${txn.flat_type}`) || 0;

            const unitData = {
                resale_price: txn.resale_price,
                town_median: townMedian,
                mrt_distance: mrt ? mrt.distance : 1500,
                remaining_lease_years: txn.remaining_lease_years || 95,
                price_history: [],
                amenities: { schools, malls, parks, hawkers }
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

            // Cache coords in transactions table
            await DB.prepare(`
                UPDATE hdb_transactions 
                SET latitude = ?, longitude = ?
                WHERE block = ? AND street_name = ?
            `).bind(coords.latitude, coords.longitude, txn.block, txn.street_name).run();

            results.push({ address: `${txn.block} ${txn.street_name}`, score: score.total_score, mrt: mrt?.name });

            // Small pause between blocks
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
            console.error(`(error) Enrichment error for ${txn.block} ${txn.street_name}:`, err);
        }
    }

    const duration = Date.now() - startTime;
    console.log(`Chunked enrichment complete. Processed ${results.length} blocks in ${duration}ms.`);

    return new Response(JSON.stringify({
        success: true,
        processed: results.length,
        duration_ms: duration,
        details: results
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
};
