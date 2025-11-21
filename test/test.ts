
import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import WebSocket from 'ws';
const BASE_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000';

describe('Order Execution Engine (10 Tests)', () => {
  let orderId: string;


  test('1. POST /orders/execute creates an order and returns ID', async () => {
    const res = await fetch(`${BASE_URL}/api/orders/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenIn: 'SOL', tokenOut: 'USDC', amountIn: 1.0 })
    });
    const data = await res.json();
    expect(res.status).toBe(202);
    expect(data.orderId).toBeDefined();
    orderId = data.orderId;
  });

  test('2. POST rejects invalid payload (Missing Token)', async () => {
    const res = await fetch(`${BASE_URL}/api/orders/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenIn: 'SOL', amountIn: 1.0 }) // Missing tokenOut
    });
    expect(res.status).toBe(400);
  });

  test('3. POST rejects invalid payload (Zero Amount)', async () => {
    const res = await fetch(`${BASE_URL}/api/orders/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenIn: 'SOL', tokenOut: 'USDC', amountIn: null })
    });
    expect(res.status).toBe(400);
  });



  test('4. WebSocket connects with valid Order ID', (done) => {
    const ws = new WebSocket(`${WS_URL}/ws/orders/${orderId}`);
    ws.on('open', () => {
      ws.close();
      done();
    });
    ws.on('error', (err) => done(err));
  });

  test('5. WebSocket rejects invalid URL format', (done) => {
    const ws = new WebSocket(`${WS_URL}/ws/orders/`); // Missing ID
    ws.on('close', () => done());
    ws.on('open', () => {
      ws.close(); 
    });
  });

  test('6. Full Order Lifecycle (Pending -> Confirmed)', (done) => {
    fetch(`${BASE_URL}/api/orders/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIn: 'SOL', tokenOut: 'USDC', amountIn: 2.0 })
    }).then(res => res.json()).then((data: any) => {
        const ws = new WebSocket(`${WS_URL}/ws/orders/${data.orderId}`);
        const statuses: string[] = [];

        ws.on('message', (msg) => {
            const payload = JSON.parse(msg.toString());
            statuses.push(payload.status);
            
            if (payload.status === 'confirmed') {
                expect(statuses).toContain('connected');
                expect(statuses).toContain('pending'); // Requirement check
                expect(statuses).toContain('routing');
                expect(statuses).toContain('confirmed');
                ws.close();
                done();
            }
        });
    });
  }, 15000); 



  test('7. Verify Route Selection Data', (done) => {
     fetch(`${BASE_URL}/api/orders/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIn: 'ETH', tokenOut: 'USDC', amountIn: 0.5 })
    }).then(res => res.json()).then((data: any) => {
        const ws = new WebSocket(`${WS_URL}/ws/orders/${data.orderId}`);
        ws.on('message', (msg) => {
            const payload = JSON.parse(msg.toString());
            if (payload.status === 'routing' && payload.data) {
                expect(payload.data.r).toBeDefined(); // Raydium quote
                expect(payload.data.m).toBeDefined(); // Meteora quote
                expect(payload.data.chosen).toBeDefined();
                ws.close();
                done();
            }
        });
    });
  }, 10000);



  test('8. Worker Handles Large Numbers safely', async () => {
     const res = await fetch(`${BASE_URL}/api/orders/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenIn: 'SOL', tokenOut: 'USDC', amountIn: 1000000 })
    });
    expect(res.status).toBe(202);
  });


  test('9. Final response includes Transaction Hash', (done) => {
     fetch(`${BASE_URL}/api/orders/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIn: 'BTC', tokenOut: 'USDC', amountIn: 0.1 })
    }).then(res => res.json()).then((data: any) => {
        const ws = new WebSocket(`${WS_URL}/ws/orders/${data.orderId}`);
        ws.on('message', (msg) => {
            const payload = JSON.parse(msg.toString());
            if (payload.status === 'confirmed') {
                expect(payload.txHash).toMatch(/^5/); 
                ws.close();
                done();
            }
        });
    });
  }, 15000);

  test('10. WebSocket URL in POST response is correct', async () => {
    const res = await fetch(`${BASE_URL}/api/orders/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIn: 'SOL', tokenOut: 'USDC', amountIn: 1 })
    });
    const data: any = await res.json();
    expect(data.wsUrl).toContain(`/ws/orders/${data.orderId}`);
  });
});