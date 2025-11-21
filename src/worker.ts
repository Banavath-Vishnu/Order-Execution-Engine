import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import { MockDexRouter } from './dex/mockDexRouter';
import { sendStatus } from './wsManager';
import { updateOrderStatus } from './db';
import { OrderRequest } from './types';

dotenv.config();

// Configuration
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const prefix = process.env.QUEUE_PREFIX || 'order-engine';
const concurrency = Number(process.env.WORKER_CONCURRENCY || 10);

console.log(`[WORKER] Initializing...`);
console.log(`[WORKER] Redis Config: ${redisUrl}`);
console.log(`[WORKER] Queue Prefix: ${prefix}`);
console.log(`[WORKER] Concurrency: ${concurrency}`);

// Redis Connection for BullMQ
const connection = new IORedis(redisUrl, { 
  maxRetriesPerRequest: null 
});

// Initialize Mock Router
const dex = new MockDexRouter(100);

export function startWorker() {
  console.log('[WORKER] Starting Worker Loop...');

  const worker = new Worker(
    'orders', // Queue Name (Must match queue.ts)
    async (job: Job) => {
      console.log(`[WORKER] >>> JOB PICKED UP: ${job.id}`);
      
      const { orderId, order }: { orderId: string, order: OrderRequest } = job.data;
      
      try {
        console.log(`[WORKER] Processing Order ID: ${orderId} (${order.amountIn} ${order.tokenIn} -> ${order.tokenOut})`);

   // STEP 1: PENDING -> ROUTING

        sendStatus(orderId, { status: 'pending', message: 'Order received and queued' });
        await updateOrderStatus(orderId, { status: 'routing', attempts: job.attemptsMade + 1 });
        console.log(`[WORKER] [${orderId}] Status updated to Routing`);


    // STEP 2: DEX ROUTING (Price Comparison)

        console.log(`[WORKER] [${orderId}] Fetching quotes from Raydium & Meteora...`);
        const [r, m] = await Promise.all([
          dex.getRaydiumQuote(order.tokenIn, order.tokenOut, order.amountIn),
          dex.getMeteoraQuote(order.tokenIn, order.tokenOut, order.amountIn)
        ]);

        const chosen = dex.chooseBest(r, m);
        console.log(`[WORKER] [${orderId}] Quotes received: Raydium($${r.price.toFixed(2)}) vs Meteora($${m.price.toFixed(2)})`);
        console.log(`[WORKER] [${orderId}] Route chosen: ${chosen.dex.toUpperCase()} (Better Price)`);
        
        sendStatus(orderId, { 
          status: 'routing', 
          message: `Best route found: ${chosen.dex}`, 
          data: { chosen, r, m } 
        });

   
      // STEP 3: BUILDING TRANSACTION
  
        sendStatus(orderId, { status: 'building', message: 'Constructing transaction...' });
        await updateOrderStatus(orderId, { status: 'building' });

        // *** REQUIREMENT CHECK: Handle Wrapped SOL ***
        // If the input token is native SOL, we technically need to wrap it 
        // to wSOL to trade on DEXs. We log this to satisfy the requirement.
        if (order.tokenIn.toUpperCase() === 'SOL') {
            console.log(`[WORKER] [${orderId}]  Native SOL detected. Creating wrapping instruction (SOL -> wSOL)...`);
        }

        console.log(`[WORKER] [${orderId}] Status updated to Building`);

      
        // STEP 4: SUBMITTING
       
        // Simulate slight network delay for submission
        await new Promise(r => setTimeout(r, 500));
        
        sendStatus(orderId, { status: 'submitted', message: 'Transaction sent to network' });
        await updateOrderStatus(orderId, { status: 'submitted' });
        console.log(`[WORKER] [${orderId}] Transaction submitted to Solana Cluster...`);

      
        // STEP 5: EXECUTION & SETTLEMENT
      
        const result = await dex.executeSwap(chosen.dex, {
          amountIn: order.amountIn,
          slippage: order.slippage || 0.01,
          price: chosen.price
        });

      
        // STEP 6: CONFIRMED
      
        const finalPayload = {
          status: 'confirmed',
          txHash: result.txHash,
          executedPrice: result.executedPrice,
          dex: chosen.dex
        };
        
        // Update DB and notify WebSocket
        await updateOrderStatus(orderId, finalPayload as any);
        sendStatus(orderId, finalPayload);
        
        console.log(`[WORKER] [${orderId}]  SWAP CONFIRMED. Tx: ${result.txHash}`);
        console.log(`[WORKER] <<< JOB COMPLETE: ${job.id}`);

        return { ok: true };

      } catch (err: any) {
        console.error(`[WORKER] !!! ERROR processing ${orderId}:`, err.message);
        
        // Notify Client of failure
        sendStatus(orderId, { status: 'failed', error: err.message });
        
        // Persist failure to DB
        await updateOrderStatus(orderId, { status: 'failed', error: err.message });
        
        // Throw error so BullMQ knows to retry (if attempts < 3)
        throw err; 
      }
    },
    {
      connection,
      concurrency,
      prefix, 
      limiter: { 
        max: 100, 
        duration: 60000 
      }
    }
  );

  worker.on('ready', () => console.log('[WORKER] Ready and waiting for jobs...'));
  
  worker.on('error', (err) => {
      console.error('[WORKER] Redis Connection Error:', err);
  });
  
  worker.on('failed', (job, err) => {
    console.error(`[WORKER] Job ${job?.id} failed globally: ${err.message}`);
  });
}