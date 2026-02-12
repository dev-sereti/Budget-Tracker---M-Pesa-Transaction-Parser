const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const socketIo = require('socket.io');
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Regular pool for app operations
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Superuser pool for initial DB setup (one-time)
const superuserPool = new Pool({ connectionString: process.env.SUPERUSER_URL });

// Middleware to verify JWT and set user_id
const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Database initialization script (your SQL code)
const setupScript = `
-- Create the database if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'budget_tracker_db') THEN
    CREATE DATABASE budget_tracker_db;
  END IF;
END $$;

-- Connect to the database (handled in code)

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role ENUM('user', 'admin') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  category_id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed categories (idempotent: skip if exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Saving') THEN
    INSERT INTO categories (name) VALUES
      ('Saving'), ('Food'), ('Family'), ('Transport'), ('Shopping'),
      ('Entertainment'), ('Mobile'), ('Housing'), ('Authenticity'),
      ('Others'), ('Clothing');
  END IF;
END $$;

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
  date TEXT,
  code VARCHAR(20),
  amount NUMERIC(15,2) DEFAULT 0,
  fee NUMERIC(15,2) DEFAULT 0,
  total_amount NUMERIC(15,2) DEFAULT 0,
  balance BYTEA,
  tx_date_ms BIGINT NOT NULL,
  timestamp BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_tx_date_ms ON transactions(tx_date_ms);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_deleted_at ON transactions(deleted_at);

-- Trigger for updated_at
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

-- Materialized view
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

CREATE INDEX IF NOT EXISTS idx_dashboard_aggregates_user_id ON dashboard_aggregates(user_id);

-- Roles for RBAC
DO $$ BEGIN
  CREATE ROLE app_user NOLOGIN;
EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'Role app_user already exists';
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions, categories TO app_user;
GRANT SELECT ON users TO app_user;

DO $$ BEGIN
  CREATE ROLE app_admin NOLOGIN INHERIT app_user;
EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'Role app_admin already exists';
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_admin;

-- Row-Level Security
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_transactions ON transactions;
CREATE POLICY user_transactions ON transactions
  USING (user_id = current_setting('app.current_user_id')::UUID)
  FOR ALL;

-- Auditing
CREATE TABLE IF NOT EXISTS audit_log (
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

DROP TRIGGER IF EXISTS trig_transactions_audit ON transactions;
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
  REFRESH MATERIALIZED VIEW dashboard_aggregates;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_transactions_notify ON transactions;
CREATE TRIGGER trig_transactions_notify
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE PROCEDURE notify_transaction_change();
`;

// Function to initialize the database on startup
async function initDatabase() {
  const client = await superuserPool.connect();
  try {
    await client.query(setupScript);
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    client.release();
  }
}

// Run init on startup
initDatabase();

// ... (rest of your server code: middleware, endpoints, Socket.io, etc.)