// @ts-ignore
import handler from '../dist/_worker.js/index.js';

export default {
    async fetch(request: Request, env: any, ctx: any) {
        return handler.fetch(request, env, ctx);
    },
    async scheduled(event: any, env: any, ctx: any) {
        console.log("Cron trigger fired:", event.cron);

        // Construct a internal request to the appropriate API route
        let path = '/api/cron';
        if (event.cron === '*/30 * * * *') {
            path = '/api/enrich';
        }

        const url = new URL(path + '?secret=manual-sync-trigger', 'http://localhost');
        const request = new Request(url, {
            headers: {
                'cf-cron': 'true',
                'host': 'hdb-insights.mediapage.workers.dev' // Optional but helpful
            }
        });

        // Cloudflare adapter exports the handler as default
        // We call it directly to trigger the Astro route logic
        ctx.waitUntil(handler.fetch(request, env, ctx));
    }
};
