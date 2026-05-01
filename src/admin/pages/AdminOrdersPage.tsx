import { OrdersTable } from '../components/OrdersTable';
import { AdminPageHeader } from '../components/AdminPageHeader';

export function AdminOrdersPage() {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Ventas"
        description="Consulta las ventas reales confirmadas por los webhooks de Mercado Pago."
      />

      <OrdersTable />
    </div>
  );
}
