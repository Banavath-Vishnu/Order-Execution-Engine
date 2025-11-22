import Fastify, { FastifyInstance } from 'fastify';
import { WebSocketServer, WebSocket } from 'ws'; // Standard WS library
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { enqueueOrder } from './queue';
import { insertOrder, initDb } from './db';
import { bindSocket } from './wsManager';
import { startWorker } from './worker';
import { OrderRequest, OrderRecord } from './types';
import { now } from './utils';

dotenv.config();

const envPort = Number(process.env.PORT);
const PORT = isNaN(envPort) ? 3000 : envPort;

// 1. TRUST PROXY: Required for Railway/Render to detect HTTPS vs HTTP
const app: FastifyInstance = Fastify({ 
  logger: true,
  trustProxy: true 
});

// Root Route
app.get('/', async () => ({ status: 'ok', service: 'Order Execution Engine' }));

app.post<{ Body: OrderRequest }>('/api/orders/execute', async (req, reply) => {
  try {
    const body = req.body;
    
    if (!body || !body.tokenIn || !body.tokenOut || !body.amountIn) {
      return reply.status(400).send({ error: 'Invalid payload' });
    }

    const orderId = uuidv4();
    
    const rec: OrderRecord = {
      id: orderId,
      type: 'market',
      tokenIn: body.tokenIn,
      tokenOut: body.tokenOut,
      amountIn: body.amountIn,
      slippage: body.slippage ?? 0.01,
      status: 'pending',
      attempts: 0,
      txHash: null,
      executedPrice: null,
      error: null,
      dex: null,
      createdAt: now(),
      updatedAt: now()
    };

    await insertOrder(rec);
    await enqueueOrder(orderId, { orderId, order: body });

    // 2. PRODUCTION URL LOGIC
    // Detects if we are on HTTPS (Production) or HTTP (Local)
    const isSecure = req.protocol === 'https';
    const protocol = isSecure ? 'wss' : 'ws';
    const host = req.headers.host; // Gets the real domain (e.g. app.railway.app)
    
    const wsUrl = `${protocol}://${host}/ws/orders/${orderId}`;
    
    return reply.status(202).send({ orderId, status: 'queued', wsUrl });

  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

(async () => {
  try {
    await initDb();
    console.log('Database initialized');
    
    startWorker(); 
    
    // Start Fastify (HTTP)
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server listening on http://0.0.0.0:${PORT}`);

    // Start Native WebSocket Server attached to Fastify
    const wss = new WebSocketServer({ server: app.server });

    wss.on('connection', (ws: WebSocket, req: any) => {
        const url = req.url || '';
        console.log(`[WS] New connection from ${url}`);

        // Grab Order ID from path: /ws/orders/UUID
        const match = url.match(/\/ws\/orders\/([a-zA-Z0-9-]+)/);
        const orderId = match ? match[1] : null;

        if (!orderId) {
            console.log('[WS] Invalid URL, closing');
            ws.send(JSON.stringify({ error: 'Invalid URL format' }));
            ws.close();
            return;
        }

        bindSocket(orderId, ws);
        ws.send(JSON.stringify({ status: 'connected', orderId, message: 'Waiting for updates...' }));
    });

    console.log('WebSocket Server attached!');

  } catch (err) {
    console.error('Bootstrap error:', err);
    process.exit(1);
  }
})();
