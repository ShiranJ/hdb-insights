/**
 * OneMap API Client for Singapore
 * Free API for geocoding and nearby amenities
 */

export interface Coordinates {
    latitude: number;
    longitude: number;
}

export interface NearbyMRT {
    name: string;
    distance: number;
}

export interface OneMapSearchResult {
    found: number;
    totalNumPages: number;
    pageNum: number;
    results: Array<{
        SEARCHVAL: string;
        BLK_NO: string;
        ROAD_NAME: string;
        BUILDING: string;
        ADDRESS: string;
        POSTAL: string;
        X: string;
        Y: string;
        LATITUDE: string;
        LONGITUDE: string;
    }>;
}

/**
 * Get coordinates for an HDB block address
 * Uses OneMap Search API (no auth required)
 */
export async function getCoordinates(
    block: string,
    street: string
): Promise<Coordinates | null> {
    const searchVal = `BLK ${block} ${street}`;
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(searchVal)}&returnGeom=Y&getAddrDetails=Y`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`OneMap search failed: ${response.status}`);
            return null;
        }

        const data = await response.json() as OneMapSearchResult;

        if (data.found > 0 && data.results.length > 0) {
            return {
                latitude: parseFloat(data.results[0].LATITUDE),
                longitude: parseFloat(data.results[0].LONGITUDE)
            };
        }

        return null;
    } catch (error) {
        console.error('OneMap search error:', error);
        return null;
    }
}

/**
 * Get OneMap authentication token
 * Required for private APIs (nearby transport, themes)
 */
export async function getOneMapToken(
    email: string,
    password: string
): Promise<string | null> {
    try {
        const response = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            console.error(`OneMap auth failed: ${response.status}`);
            return null;
        }

        const data = await response.json();
        return data.access_token || null;
    } catch (error) {
        console.error('OneMap auth error:', error);
        return null;
    }
}

/**
 * Get nearest MRT station using OneMap Private API
 * Requires authentication token
 */
export async function getNearestMRT(
    latitude: number,
    longitude: number,
    token: string
): Promise<NearbyMRT | null> {
    const url = `https://www.onemap.gov.sg/api/public/revgeocode?location=${latitude},${longitude}&token=${token}&buffer=1000&addressType=all`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`OneMap nearby transport failed: ${response.status}`);
            return null;
        }

        const data = await response.json();

        // Extract MRT info from response if available
        if (data.GeocodeInfo && data.GeocodeInfo.length > 0) {
            // Look for MRT in the building info
            for (const info of data.GeocodeInfo) {
                if (info.BUILDING && info.BUILDING.includes('MRT')) {
                    return {
                        name: info.BUILDING,
                        distance: Math.round(parseFloat(info.DISTANCE) || 0)
                    };
                }
            }
        }

        return null;
    } catch (error) {
        console.error('OneMap nearby transport error:', error);
        return null;
    }
}

/**
 * Get nearby amenities count within radius
 * Uses themes API
 */
export async function getNearbyAmenities(
    latitude: number,
    longitude: number,
    theme: 'preschools' | 'hawkercentre' | 'parks' | 'communityclubs',
    token: string
): Promise<number> {
    // Calculate bounding box (~500m radius)
    const latOffset = 0.0045;
    const lonOffset = 0.0045;

    const extents = `${longitude - lonOffset},${latitude - latOffset},${longitude + lonOffset},${latitude + latOffset}`;
    const url = `https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme?queryName=${theme}&token=${token}&extents=${extents}`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            return 0;
        }

        const data = await response.json();
        return data.SrchResults ? data.SrchResults.length - 1 : 0; // First item is metadata
    } catch {
        return 0;
    }
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 * Returns distance in meters
 */
export function calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
}
