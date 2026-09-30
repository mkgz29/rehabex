import type { AdminOrder } from './orderPresentation';

export type MetricComparison = {
  current: number;
  previous: number;
  percentage: number | null;
  direction: 'up' | 'down' | 'flat' | 'new';
};

export type ValidPaidSale = {
  order: AdminOrder;
  paidAt: Date;
  revenue: number;
};

export type SalesWindow = {
  start: Date;
  end: Date;
  includeEnd: boolean;
};

function finiteMetric(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function calculateMetricComparison(currentValue: number, previousValue: number): MetricComparison {
  const current = finiteMetric(currentValue);
  const previous = finiteMetric(previousValue);

  if (previous === 0) {
    if (current > 0) return { current, previous, percentage: null, direction: 'new' };
    if (current < 0) return { current, previous, percentage: null, direction: 'down' };
    return { current, previous, percentage: 0, direction: 'flat' };
  }

  const rawPercentage = ((current - previous) / previous) * 100;
  return {
    current,
    previous,
    percentage: Number.isFinite(rawPercentage) ? rawPercentage : null,
    direction: current > previous ? 'up' : current < previous ? 'down' : 'flat',
  };
}

export function validPaidSale(order: AdminOrder): ValidPaidSale | null {
  if (order.payment_status !== 'approved' || !order.paid_at) return null;
  if (order.total_amount === null || order.total_amount === undefined) return null;
  if (typeof order.total_amount === 'string' && order.total_amount.trim() === '') return null;

  const paidAt = new Date(order.paid_at);
  const revenue = Number(order.total_amount);
  if (!Number.isFinite(paidAt.getTime()) || !Number.isFinite(revenue)) return null;

  return { order, paidAt, revenue };
}

export function paidSalesInWindow(orders: AdminOrder[], window: SalesWindow): ValidPaidSale[] {
  const startTime = window.start.getTime();
  const endTime = window.end.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return [];

  return orders.flatMap((order) => {
    const sale = validPaidSale(order);
    if (!sale) return [];
    const paidAtTime = sale.paidAt.getTime();
    const endsInWindow = window.includeEnd ? paidAtTime <= endTime : paidAtTime < endTime;
    return paidAtTime >= startTime && endsInWindow ? [sale] : [];
  });
}

export function summarizePaidSales(sales: ValidPaidSale[]) {
  return sales.reduce(
    (summary, sale) => {
      const revenue = summary.revenue + sale.revenue;
      return {
        revenue: Number.isFinite(revenue) ? revenue : summary.revenue,
        orders: summary.orders + 1,
      };
    },
    { revenue: 0, orders: 0 },
  );
}
