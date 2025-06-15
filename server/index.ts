// server/index.ts
// Express server acting as a proxy to a real PostgreSQL instance
// All comments in English

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const mysql = require('mysql2/promise');

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

// Create MySQL pool (using env vars with MYSQL_ prefix)
const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'test',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

app.use(cors());
app.use(express.json());

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
app.post('/query', async (req: any, res: any) => {
  const { sql, params, backend } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'Missing SQL statement' });
  }
  try {
    if (backend === 'mysql') {
      // MySQL backend
      const conn = await mysqlPool.getConnection();
      try {
        // If the query is an EXPLAIN, parse the plan output
        if (/^\s*EXPLAIN/i.test(sql)) {
          const [rows, fields] = await conn.query(sql, params || []);
          // MySQL EXPLAIN returns an array of objects
          res.json({ rows, fields: Array.isArray(fields) ? fields.map((f: any) => ({ name: f.name })) : [] });
        } else {
          const [rows, fields] = await conn.query(sql, params || []);
          res.json({ rows, fields: Array.isArray(fields) ? fields.map((f: any) => ({ name: f.name })) : [] });
        }
      } finally {
        conn.release();
      }
    } else {
      // Default: PostgreSQL backend
      const result = await pool.query(sql, params || []);
      res.json({ rows: result.rows, fields: result.fields });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Health check endpoint for proxy connection test
app.get('/ping', async (req: any, res: any) => {
  const backend = req.query.backend;
  try {
    if (backend === 'mysql') {
      const conn = await mysqlPool.getConnection();
      await conn.query('SELECT 1');
      conn.release();
      res.json({ ok: true });
    } else {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(port, '127.0.0.1', () => {
  // Only use pool.options for log output
  const host = pool.options?.host;
  const pgPort = pool.options?.port;
  const user = pool.options?.user;
  const database = pool.options?.database;
  console.log('──────────────────────────────────────────────');
  console.log('🚀 Proxy Server is up and running!');
  console.log(`→ Listening on:   http://localhost:${port}`);
  console.log(`→ Target DB (PostgreSQL): postgresql://${user}@${host}:${pgPort}/${database}`);
  console.log(`→ Target DB (MySQL):      mysql://${process.env.MYSQL_USER || 'root'}@${process.env.MYSQL_HOST || 'localhost'}:${process.env.MYSQL_PORT || 3306}/${process.env.MYSQL_DATABASE || 'test'}`);
  console.log('──────────────────────────────────────────────');
});
