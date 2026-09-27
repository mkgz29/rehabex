import { OrdersTable } from '../components/OrdersTable';
import { AdminPageHeader } from '../components/AdminPageHeader';

export function AdminOrdersPage() {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Pedidos"
        description="Consultá los pedidos reales de la tienda y su estado de pago."
      />

      <OrdersTable />
    </div>
  );
}
