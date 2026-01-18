/**
 * Database utilities for HDB Insights
 */

// Type definitions for HDB data
export interface HDBTransaction {
  id?: number;
  transaction_date: string;
  month: string;
  town: string;
  flat_type: string;
  block: string;
  street_name: string;
  storey_range: string;
  floor_area_sqm: number;
  flat_model: string;
  lease_commence_date: number;
  remaining_lease: string;
  remaining_lease_years: number;
  resale_price: number;
  price_per_sqm: number;
  latitude?: number;
  longitude?: number;
  mrt_distance?: number;
  nearest_mrt?: string;
}

export interface PriceStatistics {
  town: string;
  flat_type: string;
  month: string;
  median_price: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  transaction_count: number;
  avg_price_per_sqm: number;
  price_change_pct?: number;
}

export interface UnitScore {
  id?: number;
  block: string;
  street_name: string;
  town: string;
  flat_type: string;
  total_score: number;
  price_score: number;
  location_score: number;
  lease_score: number;
  appreciation_score: number;
  amenities_score: number;
  mrt_distance?: number;
  nearest_mrt?: string;
  nearby_schools?: number;
  nearby_malls?: number;
  nearby_parks?: number;
}

// Singapore HDB Towns
export const HDB_TOWNS = [
  'ANG MO KIO', 'BEDOK', 'BISHAN', 'BUKIT BATOK', 'BUKIT MERAH',
  'BUKIT PANJANG', 'BUKIT TIMAH', 'CENTRAL AREA', 'CHOA CHU KANG',
  'CLEMENTI', 'GEYLANG', 'HOUGANG', 'JURONG EAST', 'JURONG WEST',
  'KALLANG/WHAMPOA', 'MARINE PARADE', 'PASIR RIS', 'PUNGGOL',
  'QUEENSTOWN', 'SEMBAWANG', 'SENGKANG', 'SERANGOON', 'TAMPINES',
  'TOA PAYOH', 'WOODLANDS', 'YISHUN'
] as const;

// Flat types
export const FLAT_TYPES = [
  '1 ROOM', '2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE', 'MULTI-GENERATION'
] as const;

/**
 * Parse date range string to start/end dates
 */
export function parseDateRange(range: string): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = now.toISOString().split('T')[0];
  let startDate: Date;
  
  switch (range) {
    case '1M':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case '3M':
      startDate = new Date(now.setMonth(now.getMonth() - 3));
      break;
    case '6M':
      startDate = new Date(now.setMonth(now.getMonth() - 6));
      break;
    case '1Y':
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    case '3Y':
      startDate = new Date(now.setFullYear(now.getFullYear() - 3));
      break;
    case '5Y':
      startDate = new Date(now.setFullYear(now.getFullYear() - 5));
      break;
    default: // MAX
      startDate = new Date('1990-01-01');
  }
  
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate
  };
}

/**
 * Extract lease years from remaining_lease string
 */
export function extractLeaseYears(leaseString: string | null): number | null {
  if (!leaseString) return null;
  const match = leaseString.match(/(\d+)\s*years?/i);
  return match ? parseInt(match[1]) : null;
}

/**
 * Calculate price per square meter
 */
export function calculatePricePerSqm(price: number, area: number): number {
  return Math.round((price / area) * 100) / 100;
}

/**
 * Format price for display
 */
export function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 0
  }).format(price);
}

/**
 * Calculate moving average
 */
export function calculateMovingAverage<T extends { median_price: number }>(
  data: T[],
  window: number = 3
): (T & { moving_average: number | null })[] {
  return data.map((item, idx) => {
    if (idx < window - 1) {
      return { ...item, moving_average: null };
    }
    
    const slice = data.slice(idx - window + 1, idx + 1);
    const avg = slice.reduce((sum, d) => sum + d.median_price, 0) / window;
    
    return { ...item, moving_average: Math.round(avg) };
  });
}
