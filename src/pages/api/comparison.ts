import type { APIRoute } from 'astro';
import { parseDateRange } from '../../lib/db';
import { getCached, setCache, getComparisonCacheKey, CACHE_TTL, wrapCachedResponse } from '../../lib/cache';

export const prerender = false;

interface ComparisonResponse {
    town: string;
    flat_type: string;
    range: string;
    data: Array<{
        month: string;
        transaction_count: number;
        avg_price: number;
        median_price: number;
        min_price: number;
        max_price: number;
        avg_price_psm: number;
        avg_lease: number;
        mom_pct?: number;
        yoy_pct?: number;
    }>;
}

export const GET: APIRoute = async ({ request, locals }) => {
    const url = new URL(request.url);
    const town = url.searchParams.get('town');
    const flatType = url.searchParams.get('flat_type');
    const range = url.searchParams.get('range') || '1Y';

    // New optional filters
    const storey = url.searchParams.get('storey');
    const minArea = url.searchParams.get('min_area');
    const maxArea = url.searchParams.get('max_area');
    const minLease = url.searchParams.get('min_lease');

    // Validate required parameters
    if (!town || !flatType) {
        return new Response(
            JSON.stringify({ error: 'Missing required parameters: town, flat_type' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    // Get runtime from Astro locals (Cloudflare adapter provides this)
    const runtime = locals.runtime;
    if (!runtime?.env?.DB || !runtime?.env?.CACHE) {
        return new Response(
            JSON.stringify({ error: 'Database not configured' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const { DB, CACHE } = runtime.env;

    // Check cache first
    // Bumped to v4 to ensure freshness and new schema
    // Include filters in cache key
    const filterKey = `${storey || ''}-${minArea || ''}-${maxArea || ''}-${minLease || ''}`;
    const cacheKey = getComparisonCacheKey(town, flatType, range).replace('v1', `v4-${filterKey}`);
    const cached = await getCached<ComparisonResponse>(CACHE, cacheKey);

    if (cached) {
        return new Response(
            JSON.stringify(wrapCachedResponse(cached, 'cache')),
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=3600'
                }
            }
        );
    }

    // Query D1 database
    let { startDate, endDate } = parseDateRange(range);

    // Fetch extra data for trends
    if (range === '1Y') {
        const d = new Date(startDate);
        d.setMonth(d.getMonth() - 1);
        startDate = d.toISOString().split('T')[0];
    } else if (range === '3Y' || range === '5Y') {
        const d = new Date(startDate);
        d.setFullYear(d.getFullYear() - 1);
        startDate = d.toISOString().split('T')[0];
    }

    try {
        // Build query dynamically based on filters
        let query = `
      SELECT 
        month,
        COUNT(*) as transaction_count,
        ROUND(AVG(resale_price)) as avg_price,
        MIN(resale_price) as min_price,
        MAX(resale_price) as max_price,
        ROUND(AVG(price_per_sqm), 2) as avg_price_psm,
        ROUND(AVG(remaining_lease_years), 0) as avg_lease
      FROM hdb_transactions
      WHERE town = ?
        AND flat_type = ?
        AND transaction_date >= ?
        AND transaction_date <= ?
    `;

        const params: any[] = [town, flatType, startDate, endDate];

        if (storey) {
            query += ` AND storey_range = ?`;
            params.push(storey);
        }
        if (minArea) {
            query += ` AND floor_area_sqm >= ?`;
            params.push(parseFloat(minArea));
        }
        if (maxArea) {
            query += ` AND floor_area_sqm <= ?`;
            params.push(parseFloat(maxArea));
        }
        if (minLease) {
            query += ` AND remaining_lease_years >= ?`;
            params.push(parseInt(minLease));
        }

        query += ` GROUP BY month ORDER BY month DESC`;

        // Use standard DB.prepare binding. D1 doesn't support binding array directly in query() but bind(...params) works
        const stmt = DB.prepare(query).bind(...params);
        const result = await stmt.all();

        // Calculate median for each month (requires separate query or subquery)
        // Since we have filters now, we need to apply them to the median subquery too.
        // This makes the per-month median query complex/expensive.
        // For performance in this MVP with filters, we will approximate median ~ avg or fetch median without filters?
        // No, fetching median without filters would be wrong stats.
        // We will execute a simpler median strategy: fetch ALL prices for the month+filters and calc median in JS?
        // OR construct the median query dynamically as well.
        // Dynamic median query is safer for correctness.

        const dataWithMedian = await Promise.all(
            result.results.map(async (row: Record<string, unknown>) => {
                let medianQuery = `
          SELECT resale_price
          FROM hdb_transactions
          WHERE town = ? AND flat_type = ? AND month = ?
        `;
                const medianParams: any[] = [town, flatType, row.month];

                if (storey) { medianQuery += ` AND storey_range = ?`; medianParams.push(storey); }
                if (minArea) { medianQuery += ` AND floor_area_sqm >= ?`; medianParams.push(parseFloat(minArea)); }
                if (maxArea) { medianQuery += ` AND floor_area_sqm <= ?`; medianParams.push(parseFloat(maxArea)); }
                if (minLease) { medianQuery += ` AND remaining_lease_years >= ?`; medianParams.push(parseInt(minLease)); }

                const countQuery = `SELECT COUNT(*) as count FROM (${medianQuery})`; // Subquery to count filtered rows
                // Actually we can reuse row.transaction_count? Yes, it's exact count.
                const count = row.transaction_count as number;
                const offset = Math.floor(count / 2);

                medianQuery += ` ORDER BY resale_price LIMIT 1 OFFSET ${offset}`;

                const medianResult = await DB.prepare(medianQuery).bind(...medianParams).first();

                return {
                    month: row.month as string,
                    transaction_count: row.transaction_count as number,
                    avg_price: row.avg_price as number,
                    median_price: (medianResult?.resale_price as number) || row.avg_price as number,
                    min_price: row.min_price as number,
                    max_price: row.max_price as number,
                    avg_price_psm: row.avg_price_psm as number,
                    avg_lease: row.avg_lease as number
                };
            })
        );

        const dataWithTrends = dataWithMedian.map((item, index, array) => {
            let mom_pct: number | undefined;
            if (index < array.length - 1) {
                const prev = array[index + 1];
                mom_pct = Math.round(((item.median_price - prev.median_price) / prev.median_price * 100) * 10) / 10;
            }

            let yoy_pct: number | undefined;
            const yoyIndex = index + 12;
            if (yoyIndex < array.length) {
                const yearAgo = array[yoyIndex];
                yoy_pct = Math.round(((item.median_price - yearAgo.median_price) / yearAgo.median_price * 100) * 10) / 10;
            }

            return { ...item, mom_pct, yoy_pct };
        });

        const responseData: ComparisonResponse = {
            town,
            flat_type: flatType,
            range,
            data: dataWithTrends
        };

        // Cache the result
        await setCache(CACHE, cacheKey, responseData, CACHE_TTL.COMPARISON);

        return new Response(
            JSON.stringify(wrapCachedResponse(responseData, 'fresh')),
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=3600'
                }
            }
        );
    } catch (error) {
        console.error('Comparison API error:', error);
        return new Response(
            JSON.stringify({ error: 'Database query failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};
