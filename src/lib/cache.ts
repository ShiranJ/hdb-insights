/**
 * KV Cache utilities for HDB Insights
 */

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
    COMPARISON: 3600,      // 1 hour
    TRENDS: 3600,          // 1 hour
    SCORES: 86400,         // 24 hours
    STATS: 86400,          // 24 hours
    GEOCODE: undefined,    // Forever (addresses don't change)
} as const;

// Cache version to allow invalidating old keys
const CACHE_VERSION = 'v1';

/**
 * Generate cache key for comparison queries
 */
export function getComparisonCacheKey(
    town: string,
    flatType: string,
    range: string
): string {
    return `${CACHE_VERSION}:comparison:${town}:${flatType}:${range}`;
}

/**
 * Generate cache key for trend queries
 */
export function getTrendsCacheKey(
    town: string,
    flatType: string,
    range: string
): string {
    return `${CACHE_VERSION}:trends:${town}:${flatType}:${range}`;
}

/**
 * Generate cache key for geocode data
 * (No versioning needed as geodata is static)
 */
export function getGeocodeCacheKey(block: string, street: string): string {
    return `geocode:${block}:${street}`;
}

/**
 * Generate cache key for unit scores
 */
export function getScoreCacheKey(block: string, street: string): string {
    return `${CACHE_VERSION}:score:${block}:${street}`;
}

/**
 * Get cached data with type safety
 */
export async function getCached<T>(
    kv: KVNamespace,
    key: string
): Promise<T | null> {
    try {
        const data = await kv.get(key, 'json');
        return data as T | null;
    } catch {
        return null;
    }
}

/**
 * Set cached data with optional TTL
 */
export async function setCache<T>(
    kv: KVNamespace,
    key: string,
    data: T,
    ttl?: number
): Promise<void> {
    const options = ttl ? { expirationTtl: ttl } : undefined;
    await kv.put(key, JSON.stringify(data), options);
}

/**
 * Delete cached data
 */
export async function deleteCache(kv: KVNamespace, key: string): Promise<void> {
    await kv.delete(key);
}

/**
 * Cached response wrapper with metadata
 */
export interface CachedResponse<T> {
    data: T;
    cached_at: string;
    source: 'cache' | 'fresh';
}

/**
 * Wrap data in cached response format
 */
export function wrapCachedResponse<T>(
    data: T,
    source: 'cache' | 'fresh'
): CachedResponse<T> {
    return {
        data,
        cached_at: new Date().toISOString(),
        source
    };
}
