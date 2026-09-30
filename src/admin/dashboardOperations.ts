import type { Product } from '../types/cms';
import { attentionLevel, type AdminOrder } from './orderPresentation';

export const CRITICAL_STOCK_THRESHOLD = 2;

export type DashboardOperations = {
  ordersToPrepare: AdminOrder[];
  ordersPreparing: AdminOrder[];
  ordersReadyForPickup: AdminOrder[];
  ordersShipped: AdminOrder[];
  ordersNeedingAttention: AdminOrder[];
  criticalStockProducts: Product[];
  outOfStockProducts: Product[];
};

function byStockThenName(left: Product, right: Product) {
  const stockDifference = (left.stockOnHand as number) - (right.stockOnHand as number);
  return stockDifference || left.name.localeCompare(right.name, 'es');
}

function isOperationalStock(product: Product) {
  return product.active
    && typeof product.stockOnHand === 'number'
    && Number.isFinite(product.stockOnHand)
    && product.stockOnHand >= 0;
}

/** Pure operational snapshot derived from the orders and products already loaded by the dashboard. */
export function summarizeDashboardOperations(orders: AdminOrder[], products: Product[]): DashboardOperations {
  const operations: DashboardOperations = {
    ordersToPrepare: [],
    ordersPreparing: [],
    ordersReadyForPickup: [],
    ordersShipped: [],
    ordersNeedingAttention: [],
    criticalStockProducts: [],
    outOfStockProducts: [],
  };

  for (const order of orders) {
    if (attentionLevel(order) === 'attention') {
      operations.ordersNeedingAttention.push(order);
      continue;
    }

    if (order.payment_status !== 'approved' || order.order_status !== 'confirmed') continue;

    if (order.fulfillment_status === 'not_started') operations.ordersToPrepare.push(order);
    else if (order.fulfillment_status === 'preparing') operations.ordersPreparing.push(order);
    else if (order.fulfillment_status === 'ready_for_pickup') operations.ordersReadyForPickup.push(order);
    else if (order.fulfillment_status === 'shipped') operations.ordersShipped.push(order);
  }

  const stockAlerts = products.filter(isOperationalStock).sort(byStockThenName);
  operations.outOfStockProducts = stockAlerts
    .filter((product) => product.stockOnHand === 0);
  operations.criticalStockProducts = stockAlerts
    .filter((product) => (product.stockOnHand as number) >= 1 && (product.stockOnHand as number) <= CRITICAL_STOCK_THRESHOLD);

  return operations;
}
