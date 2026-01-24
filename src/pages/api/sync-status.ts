import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
    const runtime = locals.runtime;
    if (!runtime?.env?.DB) {
        return new Response(
            JSON.stringify({ error: 'Database not configured' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const DB = runtime.env.DB;

    try {
        const result = await DB.prepare(`
            SELECT last_sync_at, status, records_processed, error_message
            FROM sync_metadata
            WHERE sync_type = 'hdb_data'
        `).first();

        if (!result) {
            return new Response(
                JSON.stringify({ error: 'Sync metadata not found' }),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify(result),
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            }
        );
    } catch (error) {
        console.error('Sync status API error:', error);
        return new Response(
            JSON.stringify({ error: 'Database query failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};
