export interface IndexedCoin {
  curve: string; creator: string; salt: string; name: string; symbol: string; description: string; image: string;
  supply: string; creatorFeeBps: number; createdAt: number;
  minter?: string; state?: number; raisedNano?: string; thresholdNano?: string; tokensPerTon?: string; statsAt?: number;
}
export interface Snapshot { coins: IndexedCoin[]; updatedAt: number; scannedTo?: string }
export function refreshIndex(opts: { master: string; prev: Snapshot | null; apiKey?: string; budgetMs: number }): Promise<Snapshot>;
