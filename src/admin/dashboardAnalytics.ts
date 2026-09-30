import type { AdminOrder } from './orderPresentation';
import {
  calculateMetricComparison,
  paidSalesInWindow,
  summarizePaidSales,
  type MetricComparison,
  type SalesWindow,
} from './salesMetrics';

export type DashboardPeriod = 7 | 30 | 90;

export type DailySalesPoint = {
  date: string;
  revenue: number;
  orders: number;
};

export type PeriodSalesSummary = {
  revenue: number;
  orders: number;
};

export type ProductSalesSummary = {
  name: string;
  quantity: number;
  revenue: number;
};

export type PeriodSalesComparison = {
  currentRevenue: number;
  previousRevenue: number;
  revenueComparison: MetricComparison;
  currentOrders: number;
  previousOrders: number;
  ordersComparison: MetricComparison;
};

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function numericValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteTotal(current: number, amount: number) {
  const total = current + amount;
  return Number.isFinite(total) ? total : current;
}

function periodWindows(days: DashboardPeriod, now: Date): { current: SalesWindow; previous: SalesWindow } {
  const currentStart = addLocalDays(startOfLocalDay(now), -(days - 1));
  // El bloque actual incluye currentStart y llega hasta now. El anterior tiene
  // exactamente `days` días y termina de forma exclusiva en currentStart.
  return {
    current: { start: currentStart, end: now, includeEnd: true },
    previous: {
      start: addLocalDays(currentStart, -days),
      end: currentStart,
      includeEnd: false,
    },
  };
}

export function buildDailySalesSeries(
  orders: AdminOrder[],
  days: DashboardPeriod,
  now: Date = new Date(),
): DailySalesPoint[] {
  if (!Number.isFinite(now.getTime())) return [];

  const firstDay = addLocalDays(startOfLocalDay(now), -(days - 1));
  const points = Array.from({ length: days }, (_, index) => ({
    date: localDateKey(addLocalDays(firstDay, index)),
    revenue: 0,
    orders: 0,
  }));
  const pointsByDate = new Map(points.map((point) => [point.date, point]));

  for (const sale of paidSalesInWindow(orders, periodWindows(days, now).current)) {
    const point = pointsByDate.get(localDateKey(sale.paidAt));
    if (!point) continue;
    point.revenue = finiteTotal(point.revenue, sale.revenue);
    point.orders += 1;
  }

  return points;
}

export function summarizePeriodSales(
  orders: AdminOrder[],
  days: DashboardPeriod,
  now: Date = new Date(),
): PeriodSalesSummary {
  return summarizePaidSales(paidSalesInWindow(orders, periodWindows(days, now).current));
}

export function comparePeriodSales(
  orders: AdminOrder[],
  days: DashboardPeriod,
  now: Date = new Date(),
): PeriodSalesComparison {
  const windows = periodWindows(days, now);
  const current = summarizePaidSales(paidSalesInWindow(orders, windows.current));
  const previous = summarizePaidSales(paidSalesInWindow(orders, windows.previous));

  return {
    currentRevenue: current.revenue,
    previousRevenue: previous.revenue,
    revenueComparison: calculateMetricComparison(current.revenue, previous.revenue),
    currentOrders: current.orders,
    previousOrders: previous.orders,
    ordersComparison: calculateMetricComparison(current.orders, previous.orders),
  };
}

export function summarizeTopProducts(
  orders: AdminOrder[],
  days: DashboardPeriod,
  now: Date = new Date(),
  limit = 5,
): ProductSalesSummary[] {
  const products = new Map<string, ProductSalesSummary>();

  for (const { order } of paidSalesInWindow(orders, periodWindows(days, now).current)) {
    if (!Array.isArray(order.order_items)) continue;

    for (const entry of order.order_items) {
      const item = (entry ?? {}) as { product_name?: unknown; quantity?: unknown; unit_price?: unknown };
      const name = typeof item.product_name === 'string' ? item.product_name.trim() : '';
      const quantity = numericValue(item.quantity);
      const unitPrice = numericValue(item.unit_price);
      if (!name || quantity === null || !Number.isInteger(quantity) || quantity <= 0 || unitPrice === null || unitPrice < 0) {
        continue;
      }

      const itemRevenue = unitPrice * quantity;
      if (!Number.isFinite(itemRevenue)) continue;

      const current = products.get(name) ?? { name, quantity: 0, revenue: 0 };
      current.quantity = finiteTotal(current.quantity, quantity);
      current.revenue = finiteTotal(current.revenue, itemRevenue);
      products.set(name, current);
    }
  }

  return [...products.values()]
    .sort((left, right) => (
      right.quantity - left.quantity
      || right.revenue - left.revenue
      || left.name.localeCompare(right.name, 'es')
    ))
    .slice(0, Math.max(0, Math.floor(limit)));
}
