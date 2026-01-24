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
    // OPTIMIZATION: OneMap Search API often fails if "BLK" is prefixed.
    // Searching for just "{block} {street}" is more reliable for HDBs.
    const searchVal = `${block} ${street}`;
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

        console.warn(`OneMap search returned 0 results for: "${searchVal}"`);
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

        const data = await response.json() as any;
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
    // OneMap Public API revgeocode: buffer is capped at 500m
    const url = `https://www.onemap.gov.sg/api/public/revgeocode?location=${latitude},${longitude}&buffer=500&addressType=all`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': token }
        });

        if (!response.ok) {
            console.error(`OneMap nearby transport failed: ${response.status}`);
            return null;
        }

        const data = await response.json() as any;

        // Extract MRT info from response if available
        if (data.GeocodeInfo && data.GeocodeInfo.length > 0) {
            for (const info of data.GeocodeInfo) {
                // OneMap building names for MRT stations typically end with 'MRT STATION'
                // Use BUILDINGNAME as discovered in recent API inspection
                const name = (info.BUILDINGNAME || info.ROAD || '').toUpperCase();
                if (name.includes('MRT') || name.includes('STATION')) {
                    if (!name.includes('TRACK') && !name.includes('POWER')) {
                        // Calculate distance manually as OneMap Public API doesn't return it in revgeocode
                        const mrtLat = parseFloat(info.LATITUDE);
                        const mrtLon = parseFloat(info.LONGITUDE);
                        const distance = calculateDistance(latitude, longitude, mrtLat, mrtLon);

                        return {
                            name: info.BUILDINGNAME || info.ROAD,
                            distance: distance
                        };
                    }
                }
            }
        }

        return null;
    } catch (error) {
        console.error('OneMap nearby transport error:', error);
        return null;
    }
}

// Supported themes: 'national_primary_schools', 'ssot_hawkercentres', 'nationalparks', 'shopping_malls' (if available), 'childcare'
export type AmenityTheme = 'national_primary_schools' | 'ssot_hawkercentres' | 'nationalparks' | 'shopping_malls' | 'childcare' | 'hawkercentre' | 'national_parks' | 'preschools';

/**
 * Get nearby amenities count within radius
 * Uses themes API
 */
export async function getNearbyAmenities(
    latitude: number,
    longitude: number,
    theme: AmenityTheme,
    token: string
): Promise<number> {
    // Map legacy themes to current production themes
    const themeMapping: Record<string, string> = {
        'hawkercentre': 'ssot_hawkercentres',
        'national_parks': 'nationalparks',
        'preschools': 'childcare'
        // 'shopping_malls': 'ssot_hawkercentres' // WRONG MAPPING removed. Malls theme might not exist publicly.
    };

    const actualTheme = themeMapping[theme] || theme;

    // Calculate bounding box (~500m radius)
    const latOffset = 0.0045;
    const lonOffset = 0.0045;

    const extents = `${longitude - lonOffset},${latitude - latOffset},${longitude + lonOffset},${latitude + latOffset}`;
    const url = `https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme?queryName=${actualTheme}&extents=${extents}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': token }
        });

        if (!response.ok) {
            // Silently ignore 404 (Theme not found) as it acts as "0 results" for non-existent themes
            if (response.status === 404) {
                return 0;
            }
            console.warn(`OneMap theme ${actualTheme} failed with status ${response.status}`);
            return 0;
        }

        const data = await response.json() as any;

        // OneMap Themes API structure: SrchResults index 0 is sometimes a metadata/offset object
        // The real results follow. If it's 404/Empty, SrchResults might be missing or contain error.
        if (data.SrchResults && Array.isArray(data.SrchResults) && data.SrchResults.length > 1) {
            return data.SrchResults.length - 1; // Exclude metadata row
        }
        return 0;
    } catch (error) {
        console.error(`OneMap theme ${actualTheme} error:`, error);
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
