/**
 * HDB Value Scoring Algorithm
 * Calculates 0-100 scores based on multiple factors
 */

export interface ScoreWeights {
    price: number;
    location: number;
    lease: number;
    appreciation: number;
    amenities: number;
}

export interface ScoreBreakdown {
    total_score: number;
    price_score: number;
    location_score: number;
    lease_score: number;
    appreciation_score: number;
    amenities_score: number;
}

export interface UnitData {
    resale_price: number;
    town_median: number;
    mrt_distance: number;
    remaining_lease_years: number;
    price_history?: number[];
    amenities?: {
        schools: number;
        malls: number;
        parks: number;
        hawkers: number;
    };
}

// Default weights
const DEFAULT_WEIGHTS: ScoreWeights = {
    price: 0.30,
    location: 0.25,
    lease: 0.20,
    appreciation: 0.15,
    amenities: 0.10
};

/**
 * Calculate price score based on price vs town median
 * 100 = 30% below median
 * 50 = at median
 * 0 = 50% above median
 */
export function calculatePriceScore(unitPrice: number, townMedian: number): number {
    if (townMedian <= 0) return 50;

    const ratio = unitPrice / townMedian;

    if (ratio <= 0.70) return 100;
    if (ratio >= 1.50) return 0;

    return Math.round(100 - ((ratio - 0.70) * 125));
}

/**
 * Calculate location score based on MRT distance
 * 100 = < 200m (walking distance)
 * 50 = 500m
 * 0 = > 1000m
 */
export function calculateLocationScore(mrtDistance: number): number {
    if (mrtDistance <= 200) return 100;
    if (mrtDistance >= 1000) return 0;

    return Math.round(100 - ((mrtDistance - 200) / 8));
}

/**
 * Calculate lease score based on remaining lease
 * 100 = 90+ years
 * 50 = 50 years
 * 0 = < 30 years
 */
export function calculateLeaseScore(remainingYears: number): number {
    if (remainingYears >= 90) return 100;
    if (remainingYears < 30) return 0;

    return Math.round((remainingYears - 30) * 1.67);
}

/**
 * Calculate appreciation score based on historical price trend
 * Uses simple linear regression
 */
export function calculateAppreciationScore(priceHistory: number[]): number {
    if (!priceHistory || priceHistory.length < 4) {
        return 50; // Neutral score for insufficient data
    }

    // Simple linear regression
    const n = priceHistory.length;
    const xSum = (n * (n - 1)) / 2;
    const ySum = priceHistory.reduce((a, b) => a + b, 0);
    const xySum = priceHistory.reduce((sum, y, x) => sum + x * y, 0);
    const xxSum = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * xySum - xSum * ySum) / (n * xxSum - xSum * xSum);
    const avgPrice = ySum / n;
    const annualGrowth = (slope / avgPrice) * 100 * 12; // Annualized

    // Score: 100 = 5%+ growth, 50 = flat, 0 = -5% decline
    if (annualGrowth >= 5) return 100;
    if (annualGrowth <= -5) return 0;

    return Math.round(50 + (annualGrowth * 10));
}

/**
 * Calculate amenities score based on proximity
 */
export function calculateAmenitiesScore(amenities: {
    schools: number;
    malls: number;
    parks: number;
    hawkers: number;
}): number {
    let score = 0;

    // Within 500m
    if (amenities.schools > 0) score += 30;
    if (amenities.malls > 0) score += 30;
    if (amenities.parks > 0) score += 20;
    if (amenities.hawkers > 0) score += 20;

    return Math.min(score, 100);
}

/**
 * Calculate total weighted score
 */
export function calculateTotalScore(
    unitData: UnitData,
    weights: ScoreWeights = DEFAULT_WEIGHTS
): ScoreBreakdown {
    const priceScore = calculatePriceScore(unitData.resale_price, unitData.town_median);
    const locationScore = calculateLocationScore(unitData.mrt_distance);
    const leaseScore = calculateLeaseScore(unitData.remaining_lease_years);
    const appreciationScore = calculateAppreciationScore(unitData.price_history || []);
    const amenitiesScore = calculateAmenitiesScore(
        unitData.amenities || { schools: 0, malls: 0, parks: 0, hawkers: 0 }
    );

    const totalScore =
        priceScore * weights.price +
        locationScore * weights.location +
        leaseScore * weights.lease +
        appreciationScore * weights.appreciation +
        amenitiesScore * weights.amenities;

    return {
        total_score: Math.round(totalScore * 10) / 10,
        price_score: priceScore,
        location_score: locationScore,
        lease_score: leaseScore,
        appreciation_score: appreciationScore,
        amenities_score: amenitiesScore
    };
}

/**
 * Get score label based on total score
 */
export function getScoreLabel(score: number): string {
    if (score >= 80) return 'Excellent Value';
    if (score >= 65) return 'Good Value';
    if (score >= 50) return 'Fair Value';
    if (score >= 35) return 'Below Average';
    return 'Poor Value';
}

/**
 * Get score color based on total score
 */
export function getScoreColor(score: number): string {
    if (score >= 80) return '#22c55e'; // green
    if (score >= 65) return '#84cc16'; // lime
    if (score >= 50) return '#eab308'; // yellow
    if (score >= 35) return '#f97316'; // orange
    return '#ef4444'; // red
}
