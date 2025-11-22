// src/queue.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

// FIX: Cast "as string" to shut up the compiler
const redisUrl = (process.env.REDIS_URL as string) || 'redis://127.0.0.1:6379';

const connection = new IORedis(redisUrl, { 
  maxRetriesPerRequest: null 
});

const prefix = (process.env.QUEUE_PREFIX as string) || 'order-engine';

export const queue = new Queue('orders', {
  connection,
  prefix
});

export async function enqueueOrder(jobId: string, payload: any) {
  await queue.add('execute-order', payload, {
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true
  });
}
