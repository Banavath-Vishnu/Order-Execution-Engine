import { Pool } from 'pg';
import dotenv from 'dotenv';
import { OrderRecord } from './types';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.PG_CONNECTION
});

export async function initDb() {
  const create = `
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    token_in TEXT NOT NULL,
    token_out TEXT NOT NULL,
    amount_in NUMERIC NOT NULL,
    slippage NUMERIC NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    dex TEXT,
    tx_hash TEXT,
    executed_price NUMERIC,
    error TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );`;
  await pool.query(create);
}

export async function insertOrder(o: OrderRecord) {
  const q = `
    INSERT INTO orders (id, type, token_in, token_out, amount_in, slippage, status, attempts, tx_hash, executed_price, error, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `;
  await pool.query(q, [
    o.id, o.type, o.tokenIn, o.tokenOut, o.amountIn, o.slippage, o.status, o.attempts || 0,
    o.txHash || null, o.executedPrice || null, o.error || null, o.createdAt, o.updatedAt
  ]);
}

export async function updateOrderStatus(id: string, fields: Partial<OrderRecord>) {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;

  for (const k of Object.keys(fields)) {
    const v = (fields as any)[k];
    if (v === undefined) continue;

    // Manual CamelCase -> snake_case mapping
    const col = k === 'tokenIn' ? 'token_in' :
                k === 'tokenOut' ? 'token_out' :
                k === 'amountIn' ? 'amount_in' :
                k === 'createdAt' ? 'created_at' :
                k === 'updatedAt' ? 'updated_at' :
                k === 'txHash' ? 'tx_hash' :
                k === 'executedPrice' ? 'executed_price' :
                k;

    sets.push(`${col} = $${i}`);
    vals.push(v);
    i++;
  }

  if (sets.length === 0) return;
  vals.push(id);
  const q = `UPDATE orders SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`;
  await pool.query(q, vals);
}