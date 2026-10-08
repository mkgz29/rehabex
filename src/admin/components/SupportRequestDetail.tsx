import { ArrowLeft, MessageCircle, TriangleAlert } from 'lucide-react';

import { formatOrderDate, fulfillmentLabel, orderLabel, orderReference, paymentLabel, type AdminOrder } from '../orderPresentation';
import { allowedNextSupportStatuses, SUPPORT_STATUS_LABELS, SUPPORT_STATUS_TONE, supportStatusActionLabel } from '../support/supportPresentation';
import type { SupportRequest, SupportRequestStatus } from '../../services/adminApi';
import { AdminCard } from './AdminCard';
import { AdminEmptyState } from './AdminEmptyState';
import { AdminSecondaryButton } from './AdminButton';
import { StatusBadge } from './StatusBadge';

export type OrderContextState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not_found' }
  | { status: 'ready'; order: AdminOrder };

type SupportRequestDetailProps = {
  supportRequest: SupportRequest | null;
  loading: boolean;
  error: string | null;
  conflict: boolean;
  orderContext: OrderContextState;
  onChangeStatus: (next: SupportRequestStatus) => void;
  statusSaving: boolean;
  notesDraft: string;
  onNotesDraftChange: (value: string) => void;
  onSaveNotes: () => void;
  notesSaving: boolean;
  notesDirty: boolean;
  onBack: () => void;
  actionError: string | null;
};

function OrderContextSection({ state }: { state: OrderContextState }) {
  if (state.status === 'idle') return null;

  return (
    <section aria-label="Pedido relacionado">
      <h4 className="text-sm font-semibold text-slate-900">Pedido</h4>
      {state.status === 'loading' ? (
        <p className="mt-2 text-sm text-slate-500" aria-busy="true">
          Cargando pedido…
        </p>
      ) : state.status === 'error' ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {state.message}
        </p>
      ) : state.status === 'not_found' ? (
        <p className="mt-2 text-sm text-slate-500">El pedido vinculado ya no existe.</p>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">Pedido</dt>
            <dd className="font-medium text-slate-900">{orderReference(state.order)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Pago</dt>
            <dd className="font-medium text-slate-900">{paymentLabel(state.order)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Estado</dt>
            <dd className="font-medium text-slate-900">{orderLabel(state.order)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Entrega</dt>
            <dd className="font-medium text-slate-900">{fulfillmentLabel(state.order)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

export function SupportRequestDetail({
  supportRequest,
  loading,
  error,
  conflict,
  orderContext,
  onChangeStatus,
  statusSaving,
  notesDraft,
  onNotesDraftChange,
  onSaveNotes,
  notesSaving,
  notesDirty,
  onBack,
  actionError,
}: SupportRequestDetailProps) {
  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 lg:hidden"
    >
      <ArrowLeft aria-hidden="true" size={16} />
      Volver a consultas
    </button>
  );

  if (loading) {
    return (
      <div>
        {backButton}
        <AdminCard tone="muted" aria-busy="true" className="text-sm text-slate-600">
          Cargando consulta…
        </AdminCard>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {backButton}
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error}
        </p>
      </div>
    );
  }

  if (!supportRequest) {
    return (
      <AdminEmptyState
        icon={MessageCircle}
        title="Seleccioná una consulta"
        description="Elegí una consulta del listado para ver el detalle."
      />
    );
  }

  const allowedTransitions = allowedNextSupportStatuses(supportRequest.status);

  return (
    <AdminCard>
      {backButton}

      {conflict ? (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
          <span>Esta consulta cambió en otra sesión. Volvimos a cargar los datos actuales antes de aplicar cualquier cambio.</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{supportRequest.subject || 'Sin asunto'}</h3>
          <p className="mt-1 text-xs text-slate-500">Creado el {formatOrderDate(supportRequest.createdAt)}</p>
        </div>
        <StatusBadge tone={SUPPORT_STATUS_TONE[supportRequest.status]} label={SUPPORT_STATUS_LABELS[supportRequest.status]} />
      </div>

      <div className="grid gap-6 border-b border-slate-200 py-5 sm:grid-cols-2">
        <section aria-label="Cliente">
          <h4 className="text-sm font-semibold text-slate-900">Cliente</h4>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-slate-500">Nombre:</dt>
              <dd className="font-medium text-slate-900">{supportRequest.customerName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-slate-500">Email:</dt>
              <dd className="font-medium text-slate-900">{supportRequest.customerEmail}</dd>
            </div>
            {supportRequest.customerPhone ? (
              <div className="flex gap-2">
                <dt className="text-slate-500">Teléfono:</dt>
                <dd className="font-medium text-slate-900">{supportRequest.customerPhone}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <OrderContextSection state={orderContext} />
      </div>

      <section className="border-b border-slate-200 py-5">
        <h4 className="text-sm font-semibold text-slate-900">Mensaje</h4>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{supportRequest.message}</p>
      </section>

      <section className="border-b border-slate-200 py-5">
        <h4 className="text-sm font-semibold text-slate-900">Estado</h4>
        <div className="mt-2 flex flex-wrap gap-2">
          {allowedTransitions.map((next) => (
            <AdminSecondaryButton key={next} size="sm" disabled={statusSaving} onClick={() => onChangeStatus(next)}>
              {supportStatusActionLabel(next)}
            </AdminSecondaryButton>
          ))}
        </div>
        {actionError ? (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {actionError}
          </p>
        ) : null}
      </section>

      <section className="pt-5">
        <h4 className="text-sm font-semibold text-slate-900">Notas internas</h4>
        <p className="mt-1 text-xs text-slate-500">No visible para el cliente.</p>
        <textarea
          value={notesDraft}
          onChange={(event) => onNotesDraftChange(event.target.value)}
          rows={4}
          maxLength={4000}
          className="admin-input mt-2"
          aria-label="Notas internas"
        />
        <div className="mt-3">
          <AdminSecondaryButton onClick={onSaveNotes} disabled={!notesDirty || notesSaving}>
            {notesSaving ? 'Guardando...' : 'Guardar nota'}
          </AdminSecondaryButton>
        </div>
      </section>
    </AdminCard>
  );
}
