// src/worker.ts
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import { MockDexRouter } from './dex/mockDexRouter';
import { sendStatus } from './wsManager';
import { updateOrderStatus } from './db';
import { OrderRequest } from './types';

dotenv.config();

// FIX: Cast "as string" here too
const redisUrl = (process.env.REDIS_URL as string) || 'redis://127.0.0.1:6379';
const prefix = (process.env.QUEUE_PREFIX as string) || 'order-engine';
const concurrency = Number(process.env.WORKER_CONCURRENCY || 10);

console.log(`[WORKER] Initializing...`);
console.log(`[WORKER] Redis Config: ${redisUrl}`);
console.log(`[WORKER] Queue Prefix: ${prefix}`);
console.log(`[WORKER] Concurrency: ${concurrency}`);

const connection = new IORedis(redisUrl, { 
  maxRetriesPerRequest: null 
});

const dex = new MockDexRouter(100);

export function startWorker() {
  console.log('[WORKER] Starting Worker Loop...');

  const worker = new Worker(
    'orders', 
    async (job: Job) => {
      console.log(`[WORKER] >>> JOB PICKED UP: ${job.id}`);
      
      const { orderId, order }: { orderId: string, order: OrderRequest } = job.data;
      
      try {
        console.log(`[WORKER] Processing Order ID: ${orderId} (${order.amountIn} ${order.tokenIn} -> ${order.tokenOut})`);
        
        // 1. PENDING
        sendStatus(orderId, { status: 'pending', message: 'Order received and queued' });
        await updateOrderStatus(orderId, { status: 'routing', attempts: job.attemptsMade + 1 });
        console.log(`[WORKER] [${orderId}] Status updated to Routing`);

        // 2. ROUTING
        console.log(`[WORKER] [${orderId}] Fetching quotes...`);
        const [r, m] = await Promise.all([
          dex.getRaydiumQuote(order.tokenIn, order.tokenOut, order.amountIn),
          dex.getMeteoraQuote(order.tokenIn, order.tokenOut, order.amountIn)
        ]);

        const chosen = dex.chooseBest(r, m);
        console.log(`[WORKER] [${orderId}] Chosen: ${chosen.dex}`);
        
        sendStatus(orderId, { 
          status: 'routing', 
          message: `Best route found: ${chosen.dex}`, 
          data: { chosen, r, m } 
        });

        // 3. BUILDING
        sendStatus(orderId, { status: 'building', message: 'Constructing transaction...' });
        await updateOrderStatus(orderId, { status: 'building' });
        
        if (order.tokenIn.toUpperCase() === 'SOL') {
            console.log(`[WORKER] [${orderId}] ℹ️  Native SOL detected. Wrapping to wSOL...`);
        }

        console.log(`[WORKER] [${orderId}] Status updated to Building`);

        // 4. SUBMITTING
        await new Promise(r => setTimeout(r, 500));
        sendStatus(orderId, { status: 'submitted', message: 'Transaction sent to network' });
        await updateOrderStatus(orderId, { status: 'submitted' });

        // 5. EXECUTION
        const result = await dex.executeSwap(chosen.dex, {
          amountIn: order.amountIn,
          slippage: order.slippage || 0.01,
          price: chosen.price
        });

        // 6. CONFIRMED
        const finalPayload = {
          status: 'confirmed',
          txHash: result.txHash,
          executedPrice: result.executedPrice,
          dex: chosen.dex
        };
        
        await updateOrderStatus(orderId, finalPayload as any);
        sendStatus(orderId, finalPayload);
        
        console.log(`[WORKER] [${orderId}] ✅ SWAP CONFIRMED. Tx: ${result.txHash}`);
        console.log(`[WORKER] <<< JOB COMPLETE: ${job.id}`);

        return { ok: true };

      } catch (err: any) {
        console.error(`[WORKER] !!! ERROR processing ${orderId}:`, err.message);
        sendStatus(orderId, { status: 'failed', error: err.message });
        await updateOrderStatus(orderId, { status: 'failed', error: err.message });
        throw err; 
      }
    },
    {
      connection,
      concurrency,
      prefix,
      limiter: { max: 100, duration: 60000 }
    }
  );

  worker.on('ready', () => console.log('[WORKER] Ready and waiting for jobs...'));
  worker.on('error', (err) => console.error('[WORKER] Redis Connection Error:', err));
  worker.on('failed', (job, err) => console.error(`[WORKER] Job ${job?.id} failed: ${err.message}`));
}
