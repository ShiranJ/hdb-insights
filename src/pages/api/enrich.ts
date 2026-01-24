import type { APIRoute } from 'astro';
import {
    getCoordinates,
    getOneMapToken,
    getNearestMRT,
    getNearbyAmenities
} from '../../lib/onemap';
import { calculateTotalScore } from '../../lib/scoring';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
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

    const token = await getOneMapToken(ONEMAP_EMAIL as string, ONEMAP_PASSWORD as string);
    if (!token) {
        return new Response('Failed to get OneMap token', { status: 500 });
    }

    // Get latest town median prices
    const statsResult = await DB.prepare(`
        SELECT town, flat_type, median_price 
        FROM price_statistics
        WHERE month = (SELECT MAX(month) FROM price_statistics)
    `).all();

    const medianMap = new Map<string, number>();
    statsResult.results.forEach((row: any) => {
        medianMap.set(`${row.town}:${row.flat_type}`, row.median_price);
    });

    // Get blocks to enrich
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
        LIMIT 50
    `).all();

    const results = [];

    for (const txn of recentTxns.results as any[]) {
        try {
            const coords = await getCoordinates(txn.block, txn.street_name);
            if (!coords) continue;

            const mrt = await getNearestMRT(coords.latitude, coords.longitude, token);
            const schools = await getNearbyAmenities(coords.latitude, coords.longitude, 'preschools', token);
            const malls = await getNearbyAmenities(coords.latitude, coords.longitude, 'shopping_malls', token);
            const parks = await getNearbyAmenities(coords.latitude, coords.longitude, 'national_parks', token);
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

            results.push({ address: `${txn.block} ${txn.street_name}`, score: score.total_score, mrt: mrt?.name });

            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (err) {
            console.error(err);
        }
    }

    return new Response(JSON.stringify({ success: true, enriched: results.length, details: results }), {
        headers: { 'Content-Type': 'application/json' }
    });
};
