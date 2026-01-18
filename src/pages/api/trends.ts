import type { APIRoute } from 'astro';
import { parseDateRange, calculateMovingAverage } from '../../lib/db';
import { getCached, setCache, getTrendsCacheKey, CACHE_TTL, wrapCachedResponse } from '../../lib/cache';

export const prerender = false;

interface TrendData {
    month: string;
    median_price: number;
    avg_price: number;
    transaction_count: number;
    price_change_pct: number | null;
    moving_average: number | null;
}

interface TrendsResponse {
    town: string;
    flat_type: string;
    range: string;
    data: TrendData[];
    summary: {
        latest_median: number;
        earliest_median: number;
        total_change_pct: number;
        avg_monthly_transactions: number;
    };
}

export const GET: APIRoute = async ({ request, locals }) => {
    const url = new URL(request.url);
    const town = url.searchParams.get('town');
    const flatType = url.searchParams.get('flat_type');
    const range = url.searchParams.get('range') || '1Y';

    if (!town || !flatType) {
        return new Response(
            JSON.stringify({ error: 'Missing required parameters: town, flat_type' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const runtime = locals.runtime;
    if (!runtime?.env?.DB || !runtime?.env?.CACHE) {
        return new Response(
            JSON.stringify({ error: 'Database not configured' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const { DB, CACHE } = runtime.env;

    // Check cache
    const cacheKey = getTrendsCacheKey(town, flatType, range);
    const cached = await getCached<TrendsResponse>(CACHE, cacheKey);

    if (cached) {
        return new Response(
            JSON.stringify(wrapCachedResponse(cached, 'cache')),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const { startDate, endDate } = parseDateRange(range);

    try {
        // Get aggregated monthly data
        const result = await DB.prepare(`
      SELECT 
        month,
        ROUND(AVG(resale_price)) as avg_price,
        COUNT(*) as transaction_count
      FROM hdb_transactions
      WHERE town = ?
        AND flat_type = ?
        AND transaction_date >= ?
        AND transaction_date <= ?
      GROUP BY month
      ORDER BY month ASC
    `).bind(town, flatType, startDate, endDate).all();

        // Calculate medians and month-over-month changes
        const dataWithCalculations: TrendData[] = [];

        for (let i = 0; i < result.results.length; i++) {
            const row = result.results[i] as Record<string, unknown>;
            const month = row.month as string;

            // Get median for this month
            const medianResult = await DB.prepare(`
        SELECT resale_price
        FROM hdb_transactions
        WHERE town = ? AND flat_type = ? AND month = ?
        ORDER BY resale_price
        LIMIT 1 OFFSET (
          SELECT COUNT(*) / 2
          FROM hdb_transactions
          WHERE town = ? AND flat_type = ? AND month = ?
        )
      `).bind(town, flatType, month, town, flatType, month).first();

            const medianPrice = (medianResult?.resale_price as number) || (row.avg_price as number);

            // Calculate MoM change
            let priceChangePct: number | null = null;
            if (i > 0 && dataWithCalculations[i - 1]) {
                const prevMedian = dataWithCalculations[i - 1].median_price;
                if (prevMedian > 0) {
                    priceChangePct = Math.round(((medianPrice - prevMedian) / prevMedian) * 1000) / 10;
                }
            }

            dataWithCalculations.push({
                month,
                median_price: medianPrice,
                avg_price: row.avg_price as number,
                transaction_count: row.transaction_count as number,
                price_change_pct: priceChangePct,
                moving_average: null
            });
        }

        // Add moving averages
        const dataWithMA = calculateMovingAverage(dataWithCalculations, 3);

        // Calculate summary
        const latestMedian = dataWithMA.length > 0 ? dataWithMA[dataWithMA.length - 1].median_price : 0;
        const earliestMedian = dataWithMA.length > 0 ? dataWithMA[0].median_price : 0;
        const totalChangePct = earliestMedian > 0
            ? Math.round(((latestMedian - earliestMedian) / earliestMedian) * 1000) / 10
            : 0;
        const avgMonthlyTransactions = dataWithMA.length > 0
            ? Math.round(dataWithMA.reduce((sum, d) => sum + d.transaction_count, 0) / dataWithMA.length)
            : 0;

        const responseData: TrendsResponse = {
            town,
            flat_type: flatType,
            range,
            data: dataWithMA,
            summary: {
                latest_median: latestMedian,
                earliest_median: earliestMedian,
                total_change_pct: totalChangePct,
                avg_monthly_transactions: avgMonthlyTransactions
            }
        };

        // Cache result
        await setCache(CACHE, cacheKey, responseData, CACHE_TTL.TRENDS);

        return new Response(
            JSON.stringify(wrapCachedResponse(responseData, 'fresh')),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Trends API error:', error);
        return new Response(
            JSON.stringify({ error: 'Database query failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};
