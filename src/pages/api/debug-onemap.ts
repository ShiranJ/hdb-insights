import type { APIRoute } from 'astro';
import { getOneMapToken } from '../../lib/onemap';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
    const runtime = locals.runtime;
    const env = runtime.env;
    const token = await getOneMapToken(env.ONEMAP_EMAIL, env.ONEMAP_PASSWORD);

    // Clementi MRT coordinates: 1.315, 103.765
    // Test revgeocode at Clementi MRT
    const res = await fetch(`https://www.onemap.gov.sg/api/public/revgeocode?location=1.315,103.765&buffer=500&addressType=all`, {
        headers: { 'Authorization': token }
    });
    const revData = await res.json();

    // Test theme at Clementi
    const themeRes = await fetch(`https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme?queryName=hawkercentre&extents=103.760,1.310,103.770,1.320`, {
        headers: { 'Authorization': token }
    });
    const themeData = await themeRes.json();

    return new Response(JSON.stringify({
        token: token ? 'Captured' : 'Failed',
        revgeocode: revData,
        theme: themeData
    }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
    });
};
