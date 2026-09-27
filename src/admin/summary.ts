import type { Product } from '../types/cms';
import { attentionLevel, type AdminOrder } from './orderPresentation';

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
