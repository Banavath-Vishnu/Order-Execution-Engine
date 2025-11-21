import { sleep } from '../utils';
import { v4 as uuidv4 } from 'uuid';

function randBetween(a: number, b: number) { return a + Math.random() * (b - a); }

export type DexName = 'raydium' | 'meteora';

export interface DexQuote {
  dex: DexName;
  price: number;
  fee: number;
  liquidity: number;
}

export class MockDexRouter {
  basePrice: number;
  constructor(basePrice = 100) { this.basePrice = basePrice; }

  async getRaydiumQuote(_in: string, _out: string, _amount: number): Promise<DexQuote> {
    await sleep(200 + Math.random() * 200);
    const price = this.basePrice * randBetween(0.98, 1.02);
    return { dex: 'raydium', price, fee: 0.003, liquidity: Math.random() * 1000 };
  }

  async getMeteoraQuote(_in: string, _out: string, _amount: number): Promise<DexQuote> {
    await sleep(200 + Math.random() * 300);
    const price = this.basePrice * randBetween(0.97, 1.03);
    return { dex: 'meteora', price, fee: 0.002, liquidity: Math.random() * 1000 };
  }

  chooseBest(a: DexQuote, b: DexQuote) {
    // Logic: Higher price is better output for a Market Sell (or buying specific tokens)
    // We assume Market Buy/Sell where Price = Output Tokens.
    if (a.price > b.price + 1e-12) return a;
    if (b.price > a.price + 1e-12) return b;
    return a.liquidity >= b.liquidity ? a : b;
  }

  async executeSwap(dex: DexName, params: { amountIn: number; slippage: number; price: number; }) {
    await sleep(2000 + Math.random() * 1000);
    
    // Simulate execution price logic
    const executedPrice = params.price * randBetween(0.995, 1.005);
    const minAccept = params.price * (1 - params.slippage);
    
    if (executedPrice < minAccept) {
        throw new Error(`Slippage Exceeded: Got ${executedPrice.toFixed(4)}, Min ${minAccept.toFixed(4)}`);
    }
    
    const txHash = `5${uuidv4().replace(/-/g, '').slice(0, 32)}`;
    return { txHash, executedPrice };
  }
}