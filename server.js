const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const socketIo = require('socket.io');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');  // Add this for password verification
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// DB Pool
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

// Real-time: Listen to PostgreSQL notifications
const realTimePool = new Pool({ connectionString: process.env.DATABASE_URL });
realTimePool.connect((err, client) => {
  if (err) throw err;
  client.query('LISTEN transaction_change');
  client.on('notification', (msg) => {
    const payload = JSON.parse(msg.payload);
    io.to(`user_${payload.user_id}`).emit('transaction_update', payload);
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.join(`user_${userId}`);
  });
});

// CRUD Endpoints

// Create transaction (from script.js addTransactionToList)
app.post('/api/transactions', authenticate, async (req, res) => {
  const { category, date, code, amount, fee, totalAmount, balance, txDateMs, timestamp } = req.body;
  const userId = req.userId;
  const encryptionKey = process.env.ENCRYPTION_KEY;

  try {
    const result = await pool.query(
      `INSERT INTO transactions (user_id, category_id, date, code, amount, fee, total_amount, balance, tx_date_ms, timestamp)
       VALUES ($1, (SELECT category_id FROM categories WHERE name = $2), $3, $4, $5, $6, $7, pgp_sym_encrypt($8::text, $9), $10, $11)
       RETURNING transaction_id`,
      [userId, category, date, code, amount, fee, totalAmount, balance, encryptionKey, txDateMs, timestamp]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read transactions (filtered for transaction.js table or dashboard.js)
app.get('/api/transactions', authenticate, async (req, res) => {
  const { startMs, endMs, limit = 50, offset = 0 } = req.query;
  const userId = req.userId;
  const encryptionKey = process.env.ENCRYPTION_KEY;

  try {
    const result = await pool.query(
      `SELECT t.*, c.name AS category,
       pgp_sym_decrypt(t.balance, $1)::NUMERIC AS balance_decrypted
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.category_id
       WHERE t.user_id = $2 AND t.deleted_at IS NULL AND t.tx_date_ms BETWEEN $3 AND $4
       ORDER BY t.tx_date_ms DESC
       LIMIT $5 OFFSET $6`,
      [encryptionKey, userId, startMs, endMs, limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update transaction
app.put('/api/transactions/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { category, amount, fee, totalAmount, balance, txDateMs } = req.body;
  const userId = req.userId;
  const encryptionKey = process.env.ENCRYPTION_KEY;

  try {
    await pool.query(
      `UPDATE transactions
       SET category_id = (SELECT category_id FROM categories WHERE name = $1),
           amount = $2, fee = $3, total_amount = $4,
           balance = pgp_sym_encrypt($5::text, $6),
           tx_date_ms = $7
       WHERE transaction_id = $8 AND user_id = $9 AND deleted_at IS NULL`,
      [category, amount, fee, totalAmount, balance, encryptionKey, txDateMs, id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete transaction (soft)
app.delete('/api/transactions/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  try {
    await pool.query(
      `UPDATE transactions SET deleted_at = CURRENT_TIMESTAMP
       WHERE transaction_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aggregates for dashboard (e.g., category totals)
app.get('/api/aggregates', authenticate, async (req, res) => {
  const { startMs, endMs } = req.query;
  const userId = req.userId;

  try {
    // Refresh view for latest data
    await pool.query('REFRESH MATERIALIZED VIEW dashboard_aggregates');

    const result = await pool.query(
      `SELECT c.name AS category, agg.total_spent
       FROM dashboard_aggregates agg
       JOIN categories c ON agg.category_id = c.category_id
       WHERE agg.user_id = $1 AND agg.latest_tx BETWEEN $2 AND $3`,
      [userId, startMs, endMs]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login endpoint to get JWT
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT user_id, password_hash FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.user_id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.listen(3000, () => console.log('Server running on port 3000'));