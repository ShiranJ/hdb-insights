-- HDB Core Tools Suite - D1 Database Schema
-- SQLite syntax for Cloudflare D1

-- Main transactions table
CREATE TABLE IF NOT EXISTS hdb_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_date TEXT,  -- ISO 8601 format (YYYY-MM-DD)
    month TEXT,             -- YYYY-MM format
    town TEXT NOT NULL,
    flat_type TEXT NOT NULL,
    block TEXT,
    street_name TEXT,
    storey_range TEXT,
    floor_area_sqm REAL,
    flat_model TEXT,
    lease_commence_date INTEGER,
    remaining_lease TEXT,
    remaining_lease_years INTEGER,
    resale_price INTEGER NOT NULL,
    price_per_sqm REAL,
    latitude REAL,
    longitude REAL,
    mrt_distance INTEGER,
    nearest_mrt TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    -- Unique constraint to prevent duplicates
    UNIQUE(month, town, flat_type, block, street_name, storey_range, resale_price)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_town_flat ON hdb_transactions(town, flat_type);
CREATE INDEX IF NOT EXISTS idx_month ON hdb_transactions(month);
CREATE INDEX IF NOT EXISTS idx_price ON hdb_transactions(resale_price);
CREATE INDEX IF NOT EXISTS idx_date ON hdb_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_location ON hdb_transactions(latitude, longitude);

-- Pre-aggregated statistics (speeds up queries)
CREATE TABLE IF NOT EXISTS price_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    town TEXT NOT NULL,
    flat_type TEXT NOT NULL,
    month TEXT NOT NULL,
    median_price INTEGER,
    avg_price INTEGER,
    min_price INTEGER,
    max_price INTEGER,
    transaction_count INTEGER,
    avg_price_per_sqm REAL,
    price_change_pct REAL,  -- vs previous month
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(town, flat_type, month)
);

CREATE INDEX IF NOT EXISTS idx_stats_town_flat ON price_statistics(town, flat_type);
CREATE INDEX IF NOT EXISTS idx_stats_month ON price_statistics(month);

-- Value scores for units
CREATE TABLE IF NOT EXISTS unit_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block TEXT NOT NULL,
    street_name TEXT NOT NULL,
    town TEXT NOT NULL,
    flat_type TEXT NOT NULL,
    total_score REAL,
    price_score REAL,
    location_score REAL,
    lease_score REAL,
    appreciation_score REAL,
    amenities_score REAL,
    mrt_distance INTEGER,
    nearest_mrt TEXT,
    nearby_schools INTEGER DEFAULT 0,
    nearby_malls INTEGER DEFAULT 0,
    nearby_parks INTEGER DEFAULT 0,
    calculated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(block, street_name, town, flat_type)
);

CREATE INDEX IF NOT EXISTS idx_score ON unit_scores(total_score DESC);
CREATE INDEX IF NOT EXISTS idx_town_score ON unit_scores(town, total_score DESC);

-- User alerts for notifications
CREATE TABLE IF NOT EXISTS user_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT NOT NULL,
    min_score REAL DEFAULT 70,
    towns TEXT,         -- JSON array string
    flat_types TEXT,    -- JSON array string
    budget_min INTEGER,
    budget_max INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_alert_active ON user_alerts(is_active);

-- Sync metadata table to track data updates
CREATE TABLE IF NOT EXISTS sync_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT NOT NULL,  -- 'hdb_data', 'geocode', 'scores'
    last_sync_at TEXT,
    records_processed INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed'
    error_message TEXT,
    UNIQUE(sync_type)
);

-- Initialize sync metadata
INSERT OR IGNORE INTO sync_metadata (sync_type, status) VALUES ('hdb_data', 'pending');
INSERT OR IGNORE INTO sync_metadata (sync_type, status) VALUES ('geocode', 'pending');
INSERT OR IGNORE INTO sync_metadata (sync_type, status) VALUES ('scores', 'pending');
