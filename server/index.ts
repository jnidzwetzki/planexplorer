// server/index.ts
// Express server acting as a proxy to a real PostgreSQL instance
// All comments in English

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import mysql from 'mysql2/promise';
import type { FieldPacket, RowDataPacket } from 'mysql2';

const app = express();
const port = Number(process.env.PORT) || 4000;

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

type QueryRequestBody = {
  sql: string;
  params?: unknown[];
  backend?: string;
};

app.post('/query', async (req: Request<Record<string, unknown>, unknown, QueryRequestBody>, res: Response) => {
  const { sql, params, backend } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'Missing SQL statement' });
  }
  try {
    if (backend === 'mysql') {
      // MySQL backend
      const conn = await mysqlPool.getConnection();
      try {
        const queryParams = Array.isArray(params) ? params : [];
        const [rows, fields] = await conn.query<RowDataPacket[] | RowDataPacket[][]>(sql, queryParams) as [RowDataPacket[] | RowDataPacket[][], FieldPacket[] | undefined];
        const safeFields = Array.isArray(fields) ? fields.map((f) => ({ name: f.name })) : [];
        res.json({ rows, fields: safeFields });
      } finally {
        conn.release();
      }
    } else {
      // Default: PostgreSQL backend
      const result = await pool.query(sql, (Array.isArray(params) ? params : []));
      res.json({ rows: result.rows, fields: result.fields });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Health check endpoint for proxy connection test
app.get('/ping', async (req: Request, res: Response) => {
  const backend = String(req.query.backend || '');
  try {
    if (backend === 'mysql') {
      const conn = await mysqlPool.getConnection();
      try {
        await conn.query('SELECT 1');
      } finally {
        conn.release();
      }
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
  const poolOptions = (pool as unknown as { options?: { host?: string; port?: number; user?: string; database?: string } }).options;
  const host = poolOptions?.host;
  const pgPort = poolOptions?.port;
  const user = poolOptions?.user;
  const database = poolOptions?.database;
  console.log('──────────────────────────────────────────────');
  console.log('🚀 Proxy Server is up and running!');
  console.log(`→ Listening on:   http://localhost:${port}`);
  console.log(`→ Target DB (PostgreSQL): postgresql://${user}@${host}:${pgPort}/${database}`);
  console.log(`→ Target DB (MySQL):      mysql://${process.env.MYSQL_USER || 'root'}@${process.env.MYSQL_HOST || 'localhost'}:${process.env.MYSQL_PORT || 3306}/${process.env.MYSQL_DATABASE || 'test'}`);
  console.log('──────────────────────────────────────────────');
});
