-- Create the database (run as postgres superuser)
CREATE DATABASE budget_tracker_db;

-- Connect to the database
\c budget_tracker_db

-- Enable extensions for security, UUIDs, and encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- For encryption/hashing
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- For UUID generation


-- Users table (for authentication and multi-user support)
CREATE TABLE users (
  user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,  -- Store hashed passwords (handle in app)
  role ENUM('user', 'admin') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Categories table (predefined from script.js dropdown)
CREATE TABLE categories (
  category_id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed categories from script.js
INSERT INTO categories (name) VALUES
  ('Saving'), ('Food'), ('Family'), ('Transport'), ('Shopping'),
  ('Entertainment'), ('Mobile'), ('Housing'), ('Authenticity'),
  ('Others'), ('Clothing');

-- Transactions table (maps to parsed data in script.js)
CREATE TABLE transactions (
  transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
  date TEXT,          -- e.g., "6/2/26 7:17 AM"
  code VARCHAR(20),   -- e.g., "UB6676349H"
  amount NUMERIC(15,2) DEFAULT 0,
  fee NUMERIC(15,2) DEFAULT 0,
  total_amount NUMERIC(15,2) DEFAULT 0,
  balance BYTEA,      -- Encrypted (use pgp_sym_encrypt in inserts)
  tx_date_ms BIGINT NOT NULL,  -- For filtering (from parseTransactionDateTime)
  timestamp BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,  -- When added
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP  -- For soft deletes
);

-- Indexes for performance (fast filtering for transaction.js and dashboard.js)
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_tx_date_ms ON transactions(tx_date_ms);
CREATE INDEX idx_transactions_category_id ON transactions(category_id);
CREATE INDEX idx_transactions_deleted_at ON transactions(deleted_at);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trig_transactions_update
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE PROCEDURE update_timestamp();

-- Materialized view for dashboard aggregates (fast KPIs/charts in dashboard.js)
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

CREATE INDEX idx_dashboard_aggregates_user_id ON dashboard_aggregates(user_id);

-- Roles for RBAC
CREATE ROLE app_user NOLOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions, categories TO app_user;
GRANT SELECT ON users TO app_user;

CREATE ROLE app_admin INHERIT app_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_admin;

-- Row-Level Security (users only access their data)
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_transactions ON transactions
  USING (user_id = current_setting('app.current_user_id')::UUID)
  FOR ALL;

-- Auditing for changes (logs updates/deletes for security)
CREATE TABLE audit_log (
  log_id SERIAL PRIMARY KEY,
  table_name TEXT,
  operation TEXT,
  user_id UUID,
  old_data JSONB,
  new_data JSONB,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (table_name, operation, user_id, old_data, new_data)
  VALUES (TG_TABLE_NAME, TG_OP, current_setting('app.current_user_id')::UUID, to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trig_transactions_audit
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE PROCEDURE audit_trigger();

-- Real-time notification trigger
CREATE OR REPLACE FUNCTION notify_transaction_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('transaction_change', json_build_object(
    'user_id', NEW.user_id,
    'operation', TG_OP,
    'transaction_id', NEW.transaction_id
  )::text);
  REFRESH MATERIALIZED VIEW dashboard_aggregates;  -- Update aggregates for dashboard
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trig_transactions_notify
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE PROCEDURE notify_transaction_change();