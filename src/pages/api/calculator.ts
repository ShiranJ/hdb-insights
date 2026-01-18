import type { APIRoute } from 'astro';
import { getScoreLabel, getScoreColor } from '../../lib/scoring';

export const prerender = false;

interface CalculatorResult {
    id: number;
    block: string;
    street_name: string;
    town: string;
    flat_type: string;
    resale_price: number;
    floor_area_sqm: number;
    remaining_lease: string;
    total_score: number;
    price_score: number;
    location_score: number;
    lease_score: number;
    appreciation_score: number;
    amenities_score: number;
    mrt_distance: number | null;
    nearest_mrt: string | null;
    score_label: string;
    score_color: string;
}

interface CalculatorResponse {
    results: CalculatorResult[];
    count: number;
    filters: {
        min_score: number;
        towns: string[];
        flat_types: string[];
        budget_min: number | null;
        budget_max: number | null;
    };
}

export const GET: APIRoute = async ({ request, locals }) => {
    const url = new URL(request.url);
    const minScore = parseFloat(url.searchParams.get('min_score') || '0');
    const towns = url.searchParams.get('towns')?.split(',').filter(Boolean) || [];
    const flatTypes = url.searchParams.get('flat_types')?.split(',').filter(Boolean) || [];
    const budgetMin = url.searchParams.get('budget_min') ? parseInt(url.searchParams.get('budget_min')!) : null;
    const budgetMax = url.searchParams.get('budget_max') ? parseInt(url.searchParams.get('budget_max')!) : null;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

    const runtime = locals.runtime;
    if (!runtime?.env?.DB) {
        return new Response(
            JSON.stringify({ error: 'Database not configured' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const { DB } = runtime.env;

    try {
        // Build dynamic query
        let query = `
      SELECT 
        us.id,
        us.block,
        us.street_name,
        us.town,
        us.flat_type,
        us.total_score,
        us.price_score,
        us.location_score,
        us.lease_score,
        us.appreciation_score,
        us.amenities_score,
        us.mrt_distance,
        us.nearest_mrt,
        ht.resale_price,
        ht.floor_area_sqm,
        ht.remaining_lease
      FROM unit_scores us
      LEFT JOIN (
        SELECT block, street_name, town, flat_type, 
               resale_price, floor_area_sqm, remaining_lease,
               ROW_NUMBER() OVER (PARTITION BY block, street_name, town, flat_type ORDER BY transaction_date DESC) as rn
        FROM hdb_transactions
      ) ht ON us.block = ht.block 
           AND us.street_name = ht.street_name 
           AND us.town = ht.town 
           AND us.flat_type = ht.flat_type
           AND ht.rn = 1
      WHERE us.total_score >= ?
    `;

        const params: (string | number)[] = [minScore];

        // Add town filter
        if (towns.length > 0) {
            query += ` AND us.town IN (${towns.map(() => '?').join(',')})`;
            params.push(...towns);
        }

        // Add flat type filter
        if (flatTypes.length > 0) {
            query += ` AND us.flat_type IN (${flatTypes.map(() => '?').join(',')})`;
            params.push(...flatTypes);
        }

        // Add budget filters
        if (budgetMin !== null) {
            query += ` AND ht.resale_price >= ?`;
            params.push(budgetMin);
        }
        if (budgetMax !== null) {
            query += ` AND ht.resale_price <= ?`;
            params.push(budgetMax);
        }

        query += ` ORDER BY us.total_score DESC LIMIT ?`;
        params.push(limit);

        const result = await DB.prepare(query).bind(...params).all();

        const results: CalculatorResult[] = result.results.map((row: Record<string, unknown>) => ({
            id: row.id as number,
            block: row.block as string,
            street_name: row.street_name as string,
            town: row.town as string,
            flat_type: row.flat_type as string,
            resale_price: row.resale_price as number,
            floor_area_sqm: row.floor_area_sqm as number,
            remaining_lease: row.remaining_lease as string,
            total_score: row.total_score as number,
            price_score: row.price_score as number,
            location_score: row.location_score as number,
            lease_score: row.lease_score as number,
            appreciation_score: row.appreciation_score as number,
            amenities_score: row.amenities_score as number,
            mrt_distance: row.mrt_distance as number | null,
            nearest_mrt: row.nearest_mrt as string | null,
            score_label: getScoreLabel(row.total_score as number),
            score_color: getScoreColor(row.total_score as number)
        }));

        const response: CalculatorResponse = {
            results,
            count: results.length,
            filters: {
                min_score: minScore,
                towns,
                flat_types: flatTypes,
                budget_min: budgetMin,
                budget_max: budgetMax
            }
        };

        return new Response(
            JSON.stringify(response),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Calculator API error:', error);
        return new Response(
            JSON.stringify({ error: 'Database query failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};
