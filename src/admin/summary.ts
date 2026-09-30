import type { Product } from '../types/cms';
import { attentionLevel, orderAmount, type AdminOrder } from './orderPresentation';

export const LOW_STOCK_THRESHOLD = 5;

export type BusinessDashboardSummary = {
  monthlyPaidSales: number;
  monthlyPaidOrders: number;
  averageTicket: number;
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

function isInCurrentMonth(value: string | null | undefined, now: Date) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
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
  const paidOrdersThisMonth = orders.filter(
    (order) => order.payment_status === 'approved' && isInCurrentMonth(order.paid_at, now),
  );
  const monthlyPaidSales = paidOrdersThisMonth.reduce((total, order) => total + orderAmount(order), 0);

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
    monthlyPaidSales,
    monthlyPaidOrders: paidOrdersThisMonth.length,
    averageTicket: paidOrdersThisMonth.length > 0 ? monthlyPaidSales / paidOrdersThisMonth.length : 0,
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
