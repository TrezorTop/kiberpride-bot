// Shop — NOT implemented in this step; the interface fixes the shape (decisions 002 §5, 003 §6).
// buy = one transaction: insert Purchase (partial unique index blocks a double buy),
// economy.move(-price, `purchase:<id>`), commit; the role is applied after the commit.

export interface ShopGoodView {
  id: number;
  slug: string;
  name: string;
  description: string;
  price: number;
  kind: string;
  validityDays: number | null;
}

export interface ShopService {
  listEnabled(): Promise<ShopGoodView[]>;
  buy(userId: string, goodId: number): Promise<{ purchaseId: number; balanceAfter: number }>;
}
