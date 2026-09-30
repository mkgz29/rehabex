import type { Product } from '../types/cms';
import { attentionLevel, type AdminOrder } from './orderPresentation';
import {
  calculateMetricComparison,
  paidSalesInWindow,
  summarizePaidSales,
  type MetricComparison,
} from './salesMetrics';

export const LOW_STOCK_THRESHOLD = 5;

export type BusinessDashboardSummary = {
  monthlyPaidSales: number;
  monthlyPaidOrders: number;
  averageTicket: number;
  monthlyComparison: {
    sales: MetricComparison;
    orders: MetricComparison;
    averageTicket: MetricComparison;
  };
  ordersNeedingAttention: number;
  orderStatus: {
    confirmed: number;
    waitingForPayment: number;
    requiringReview: number;
    finalizedWithoutSale: number;
  };
  catalog: {
    activeProducts: number;
    hiddenProducts: number;
    lowStockProducts: number;
    lowestStockProducts: Product[];
  };
  recentOrders: AdminOrder[];
};

export function summarizeProducts(products: Product[]) {
  return {
    visibleProducts: products.filter((product) => product.active).length,
    hiddenProducts: products.filter((product) => !product.active).length,
  };
}

export function summarizeOrders(orders: AdminOrder[]) {
  return {
    orderCount: orders.length,
    ordersNeedingReview: orders.filter((order) => attentionLevel(order) === 'attention').length,
    recentOrders: [...orders]
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
      .slice(0, 5),
  };
}

function isLowStockProduct(product: Product) {
  return product.active
    && typeof product.stockOnHand === 'number'
    && Number.isFinite(product.stockOnHand)
    && product.stockOnHand >= 0
    && product.stockOnHand <= LOW_STOCK_THRESHOLD;
}

/** Pure business summary derived exclusively from the orders and products already loaded by the admin home. */
export function summarizeBusinessDashboard(
  orders: AdminOrder[],
  products: Product[],
  now: Date = new Date(),
): BusinessDashboardSummary {
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // Decisión deliberada: el mes calendario actual sólo hasta `now` se compara
  // contra el mes calendario anterior completo. No se normaliza por días
  // transcurridos ni se proyecta el resto del mes.
  const currentMonth = summarizePaidSales(paidSalesInWindow(orders, {
    start: currentMonthStart,
    end: now,
    includeEnd: true,
  }));
  const previousMonth = summarizePaidSales(paidSalesInWindow(orders, {
    start: previousMonthStart,
    end: currentMonthStart,
    includeEnd: false,
  }));
  const averageTicket = currentMonth.orders > 0 ? currentMonth.revenue / currentMonth.orders : 0;
  const previousAverageTicket = previousMonth.orders > 0 ? previousMonth.revenue / previousMonth.orders : 0;

  const orderStatus = {
    confirmed: 0,
    waitingForPayment: 0,
    requiringReview: 0,
    finalizedWithoutSale: 0,
  };

  for (const order of orders) {
    const level = attentionLevel(order);
    if (level === 'attention') {
      orderStatus.requiringReview += 1;
      continue;
    }
    if (level === 'waiting') {
      orderStatus.waitingForPayment += 1;
      continue;
    }
    if (
      order.payment_status === 'approved'
      && (order.order_status === 'confirmed' || order.order_status === 'completed')
    ) {
      orderStatus.confirmed += 1;
      continue;
    }
    if (
      order.payment_status === 'rejected'
      || order.payment_status === 'cancelled'
      || order.payment_status === 'refunded'
      || order.order_status === 'cancelled'
      || order.order_status === 'refunded'
      || order.order_status === 'expired'
    ) {
      orderStatus.finalizedWithoutSale += 1;
    }
  }

  const { visibleProducts, hiddenProducts } = summarizeProducts(products);
  const allLowStockProducts = products
    .filter(isLowStockProduct)
    .sort((left, right) => {
      const stockDifference = (left.stockOnHand as number) - (right.stockOnHand as number);
      return stockDifference || left.name.localeCompare(right.name, 'es');
    });
  const orderSummary = summarizeOrders(orders);

  return {
    monthlyPaidSales: currentMonth.revenue,
    monthlyPaidOrders: currentMonth.orders,
    averageTicket,
    monthlyComparison: {
      sales: calculateMetricComparison(currentMonth.revenue, previousMonth.revenue),
      orders: calculateMetricComparison(currentMonth.orders, previousMonth.orders),
      averageTicket: calculateMetricComparison(averageTicket, previousAverageTicket),
    },
    ordersNeedingAttention: orderSummary.ordersNeedingReview,
    orderStatus,
    catalog: {
      activeProducts: visibleProducts,
      hiddenProducts,
      lowStockProducts: allLowStockProducts.length,
      lowestStockProducts: allLowStockProducts.slice(0, 3),
    },
    recentOrders: orderSummary.recentOrders,
  };
}
