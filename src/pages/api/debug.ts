import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Debug endpoint to test DB connection and API access
 */
export const GET: APIRoute = async ({ locals }) => {
    const runtime = locals.runtime;

    // Check runtime
    if (!runtime) {
        return new Response(
            JSON.stringify({ error: 'Runtime not available', runtime: typeof runtime }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    // Check env
    if (!runtime.env) {
        return new Response(
            JSON.stringify({ error: 'Env not available', env: typeof runtime.env }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    // Check DB
    if (!runtime.env.DB) {
        return new Response(
            JSON.stringify({
                error: 'DB not available',
                availableBindings: Object.keys(runtime.env)
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const DB = runtime.env.DB;

    try {
        // Test simple query
        const result = await DB.prepare('SELECT 1 as test').first();

        // Try to get transaction count
        const countResult = await DB.prepare('SELECT COUNT(*) as count FROM hdb_transactions').first();

        // Get sync status
        const syncResult = await DB.prepare('SELECT * FROM sync_metadata').all();

        return new Response(
            JSON.stringify({
                success: true,
                db_test: result,
                transaction_count: countResult?.count ?? 0,
                sync_status: syncResult.results
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({
                error: 'DB query failed',
                details: String(error),
                message: error instanceof Error ? error.message : 'Unknown error'
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};
