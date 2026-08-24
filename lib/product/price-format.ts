// Presentation-only price formatting for product cards/summaries — never touches the
// underlying price value or currency stored on the product. `currency` is whatever the
// source page gave us (often a symbol like "$", sometimes an ISO code like "USD" from
// schema.org priceCurrency), so a purely symbolic currency sits flush against the amount
// while a multi-character code keeps a separating space.
export function formatProductPrice(price: number, currency: string | null): string {
  const symbol = currency ?? "$";
  const hasCents = Math.round(price * 100) % 100 !== 0;
  const amount = price.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
  const isSymbol = /^[^A-Za-z0-9]+$/.test(symbol);
  return isSymbol ? `${symbol}${amount}` : `${symbol} ${amount}`;
}
