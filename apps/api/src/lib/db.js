import pg from 'pg';
import { env, isProduction } from '../config/env.js';
import { logger } from './logger.js';

const { Pool } = pg;

// Verifies the server certificate by default — rejectUnauthorized: false accepts
// any certificate, including a forged one, and defeats the point of TLS. Only
// disable it via DATABASE_SSL_REJECT_UNAUTHORIZED=false as an explicit, logged
// choice, never silently.
function sslConfig() {
  if (!isProduction) return undefined;

  if (!env.DATABASE_SSL_REJECT_UNAUTHORIZED) {
    logger.warn(
      'DATABASE_SSL_REJECT_UNAUTHORIZED=false — Postgres certificate verification is ' +
        'DISABLED. The connection is vulnerable to MITM. Set DATABASE_SSL_CA to the ' +
        "provider's CA instead, if at all possible.",
    );
  }

  return {
    rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    ca: env.DATABASE_SSL_CA || undefined,
  };
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: sslConfig(),
});

pool.on('error', (err) => {
  logger.error({ err }, 'idle postgres client error');
});

export const query = (text, params) => pool.query(text, params);

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDb() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}
