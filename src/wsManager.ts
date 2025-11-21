import WebSocket from 'ws';

const sockets = new Map<string, WebSocket>();

export function bindSocket(orderId: string, ws: WebSocket) {
  const existing = sockets.get(orderId);
  if (existing && existing !== ws) {
    try { existing.close(); } catch {}
  }
  sockets.set(orderId, ws);
  
  ws.on('close', () => {
    if (sockets.get(orderId) === ws) {
      sockets.delete(orderId);
    }
  });
}

export function sendStatus(orderId: string, payload: any) {
  const ws = sockets.get(orderId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { 
    ws.send(JSON.stringify(payload)); 
  } catch (e) { 
    console.error(`WS Send Error for ${orderId}:`, e); 
  }
}