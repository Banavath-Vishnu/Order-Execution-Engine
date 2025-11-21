
export type OrderType = 'market' | 'limit' | 'sniper';

export interface OrderRequest {
  type?: OrderType;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippage?: number; // e.g., 0.01 for 1%
}

export type OrderStatus = 'pending' | 'routing' | 'building' | 'submitted' | 'confirmed' | 'failed';

export interface OrderRecord {
  id: string;
  type: OrderType;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippage: number;
  status: OrderStatus;
  attempts: number;
  dex?: string | null;
  txHash?: string | null;
  executedPrice?: number | null;
  error?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}