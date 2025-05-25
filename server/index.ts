// server/index.ts
// Express server acting as a proxy to a real PostgreSQL instance
// All comments in English

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 4000;

// Configure PostgreSQL connection from environment variables
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'postgres',
});

app.use(cors());
app.use(express.json());

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
app.post('/query', async (req: any, res: any) => {
  const { sql, params } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'Missing SQL statement' });
  }
  try {
    const result = await pool.query(sql, params || []);
    res.json({ rows: result.rows, fields: result.fields });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Health check endpoint for proxy connection test
app.get('/ping', async (req: any, res: any) => {
  try {
    // Simple query to check DB connection
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(port, '127.0.0.1', () => {
  console.log(`PostgreSQL proxy server listening on http://localhost:${port}`);
});
