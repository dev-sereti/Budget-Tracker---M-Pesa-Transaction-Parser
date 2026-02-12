-- init_fixed.sql
-- Run this as a superuser (psql -U postgres -f init_fixed.sql)
-- Creates budget_tracker_db and the schema for the budget tracker app.

-- 1) Create the database (psql must be connected to a database that allows CREATE DATABASE)
CREATE DATABASE budget_tracker_db;
\c budget_tracker_db

-- 2) Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3) Create enum type for user role (if missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('user', 'admin');
  END IF;
END$$;

-- 4) Users table
CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5) Categories table
CREATE TABLE IF NOT EXISTS categories (
  category_id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6) Seed categories (safe to re-run)
INSERT INTO categories (name)
VALUES
  ('Saving'), ('Food'), ('Family'), ('Transport'), ('Shopping'),
  ('Entertainment'), ('Mobile'), ('Housing'), ('Authenticity'),
  ('Others'), ('Clothing')
ON CONFLICT (name) DO NOTHING;

-- 7) Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
  date_text TEXT,          -- e.g., "6/2/26" or "4/2/26 5:55 PM"
  code VARCHAR(50),        -- e.g., "UB6676349H"
  amount NUMERIC(15,2) DEFAULT 0,
  fee NUMERIC(15,2) DEFAULT 0,
  total_amount NUMERIC(15,2) DEFAULT 0,
  balance BYTEA,           -- encrypted balance (pgp_sym_encrypt)
  tx_date_ms BIGINT NOT NULL,  -- milliseconds since epoch
  timestamp BIGINT DEFAULT ((EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- 8) Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_tx_date_ms ON transactions(tx_date_ms);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_deleted_at ON transactions(deleted_at);

-- 9) Trigger function to update updated_at
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_transactions_update ON transactions;
CREATE TRIGGER trig_transactions_update
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE PROCEDURE update_timestamp();

-- 10) Materialized view for dashboard aggregates (create once; refresh manually)
DROP MATERIALIZED VIEW IF EXISTS dashboard_aggregates;
CREATE MATERIALIZED VIEW dashboard_aggregates AS
SELECT 
  user_id,
  category_id,
  SUM(total_amount) AS total_spent,
  COUNT(*) AS transaction_count,
  MIN(tx_date_ms) AS earliest_tx,
  MAX(tx_date_ms) AS latest_tx
FROM transactions
WHERE deleted_at IS NULL
GROUP BY user_id, category_id;

-- Add a unique index to allow CONCURRENT refresh if needed
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_aggregates_user_category
  ON dashboard_aggregates(user_id, category_id);

-- 11) Helper function to safely read the app.current_user_id GUC
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS UUID AS $$
DECLARE
  v TEXT;
BEGIN
  v := current_setting('app.current_user_id', true);
  IF v IS NULL OR btrim(v) = '' THEN
    RETURN NULL;
  END IF;
  RETURN v::uuid;
END;
$$ LANGUAGE plpgsql STABLE;

-- 12) Row-Level Security (optional)
-- Enable RLS and create a per-user policy — only enable if you will set app.current_user_id in sessions
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_transactions ON transactions;
CREATE POLICY user_transactions ON transactions
  USING (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id())
  WITH CHECK (app_current_user_id() IS NOT NULL AND user_id = app_current_user_id());

-- 13) Audit log & trigger (safe to re-run)
CREATE TABLE IF NOT EXISTS audit_log (
  log_id SERIAL PRIMARY KEY,
  table_name TEXT,
  operation TEXT,
  user_id UUID,
  old_data JSONB,
  new_data JSONB,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log(table_name, operation, user_id, old_data, new_data)
    VALUES (TG_TABLE_NAME, TG_OP, app_current_user_id(), NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log(table_name, operation, user_id, old_data, new_data)
    VALUES (TG_TABLE_NAME, TG_OP, app_current_user_id(), to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log(table_name, operation, user_id, old_data, new_data)
    VALUES (TG_TABLE_NAME, TG_OP, app_current_user_id(), to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_transactions_audit ON transactions;
CREATE TRIGGER trig_transactions_audit
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE PROCEDURE audit_trigger();

-- 14) Notification trigger (emit NOTIFY; do NOT refresh materialized view per row)
-- Refreshing the materialized view per-row is expensive — refresh manually or via a cron job.
CREATE OR REPLACE FUNCTION notify_transaction_change()
RETURNS TRIGGER AS $$
DECLARE
  uid UUID;
  tid UUID;
  op TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    uid := OLD.user_id;
    tid := OLD.transaction_id;
    op := TG_OP;
  ELSE
    uid := NEW.user_id;
    tid := NEW.transaction_id;
    op := TG_OP;
  END IF;

  PERFORM pg_notify('transaction_change', json_build_object(
    'user_id', uid,
    'operation', op,
    'transaction_id', tid
  )::text);

  -- Do NOT refresh dashboard materialized view here (too expensive). Refresh it from a scheduled job or admin action:
  -- REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_aggregates;

  RETURN NULL; -- for AFTER triggers, returning NULL is allowed; we do not modify the row here
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_transactions_notify ON transactions;
CREATE TRIGGER trig_transactions_notify
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE PROCEDURE notify_transaction_change();

-- 15) Roles and grants (create roles if missing, then grant privileges)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN;
  END IF;
END$$;

-- Grant table privileges to roles (tables exist at this point)
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions, categories TO app_user;
GRANT SELECT ON users TO app_user;

-- Make app_admin inherit app_user permissions by granting membership
GRANT app_user TO app_admin;

-- Make app_admin a super-role for schema objects (only for convenience in dev)
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_admin;