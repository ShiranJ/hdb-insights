import type { APIRoute } from 'astro';

export const prerender = false;

interface SearchResult {
    id: number;
    month: string;
    town: string;
    flat_type: string;
    block: string;
    street_name: string;
    storey_range: string;
    floor_area_sqm: number;
    flat_model: string;
    remaining_lease: string;
    resale_price: number;
    price_per_sqm: number;
}

interface SearchResponse {
    results: SearchResult[];
    count: number;
    total: number;
    page: number;
    per_page: number;
}

export const GET: APIRoute = async ({ request, locals }) => {
    const url = new URL(request.url);
    const town = url.searchParams.get('town');
    const flatType = url.searchParams.get('flat_type');
    const block = url.searchParams.get('block');
    const street = url.searchParams.get('street');
    const minPrice = url.searchParams.get('min_price') ? parseInt(url.searchParams.get('min_price')!) : null;
    const maxPrice = url.searchParams.get('max_price') ? parseInt(url.searchParams.get('max_price')!) : null;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') || '20')));

    const runtime = locals.runtime;
    if (!runtime?.env?.DB) {
        return new Response(
            JSON.stringify({ error: 'Database not configured' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const { DB } = runtime.env;

    try {
        // Build WHERE clause
        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (town) {
            conditions.push('town = ?');
            params.push(town);
        }
        if (flatType) {
            conditions.push('flat_type = ?');
            params.push(flatType);
        }
        if (block) {
            conditions.push('block LIKE ?');
            params.push(`%${block}%`);
        }
        if (street) {
            conditions.push('street_name LIKE ?');
            params.push(`%${street}%`);
        }
        if (minPrice !== null) {
            conditions.push('resale_price >= ?');
            params.push(minPrice);
        }
        if (maxPrice !== null) {
            conditions.push('resale_price <= ?');
            params.push(maxPrice);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Get total count
        const countResult = await DB.prepare(
            `SELECT COUNT(*) as total FROM hdb_transactions ${whereClause}`
        ).bind(...params).first();

        const total = (countResult?.total as number) || 0;

        // Get paginated results
        const offset = (page - 1) * perPage;
        const result = await DB.prepare(`
      SELECT 
        id, month, town, flat_type, block, street_name,
        storey_range, floor_area_sqm, flat_model,
        remaining_lease, resale_price, price_per_sqm
      FROM hdb_transactions
      ${whereClause}
      ORDER BY transaction_date DESC, resale_price DESC
      LIMIT ? OFFSET ?
    `).bind(...params, perPage, offset).all();

        const results: SearchResult[] = result.results.map((row: Record<string, unknown>) => ({
            id: row.id as number,
            month: row.month as string,
            town: row.town as string,
            flat_type: row.flat_type as string,
            block: row.block as string,
            street_name: row.street_name as string,
            storey_range: row.storey_range as string,
            floor_area_sqm: row.floor_area_sqm as number,
            flat_model: row.flat_model as string,
            remaining_lease: row.remaining_lease as string,
            resale_price: row.resale_price as number,
            price_per_sqm: row.price_per_sqm as number
        }));

        const response: SearchResponse = {
            results,
            count: results.length,
            total,
            page,
            per_page: perPage
        };

        return new Response(
            JSON.stringify(response),
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=300' // 5 min cache
                }
            }
        );
    } catch (error) {
        console.error('Search API error:', error);
        return new Response(
            JSON.stringify({ error: 'Database query failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};
