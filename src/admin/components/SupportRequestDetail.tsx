import { Archive, ArrowLeft, MessageCircle, RotateCcw, TriangleAlert } from 'lucide-react';
import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

import { formatOrderDate, fulfillmentLabel, orderLabel, orderReference, paymentLabel, type AdminOrder } from '../orderPresentation';
import { allowedNextSupportStatuses, SUPPORT_SOURCE_LABELS, SUPPORT_STATUS_LABELS, SUPPORT_STATUS_TONE, SUPPORT_TOPIC_LABELS, supportStatusActionLabel } from '../support/supportPresentation';
import { buildSupportWhatsAppMessage } from '../whatsapp';
import type { SupportRequest, SupportRequestStatus } from '../../services/adminApi';
import { AdminCard } from './AdminCard';
import { AdminEmptyState } from './AdminEmptyState';
import { AdminIconButton, type IconButtonTone } from './AdminIconButton';
import { AdminSecondaryButton } from './AdminButton';
import { GmailContactLink } from './GmailContactLink';
import { StatusBadge } from './StatusBadge';
import { WhatsAppContactButton } from './WhatsAppContactButton';

// Only the two high-priority status actions (FASE 7D.4) get an icon
// treatment; "Marcar respondida"/"Marcar resuelta" stay plain text -- there
// is no equally obvious universal icon for those, and the task scoped icons
// to WhatsApp/Gmail/Archivar/Reabrir/Actualizar. Archive is a soft amber,
// never the destructive red: archiving a ticket never deletes anything.
const STATUS_ACTION_ICON: Partial<Record<SupportRequestStatus, { icon: ComponentType<LucideProps>; tone: IconButtonTone }>> = {
  archived: { icon: Archive, tone: 'archive' },
  open: { icon: RotateCcw, tone: 'reopen' },
};

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

/**
 * The order reference to greet the customer with over WhatsApp: a real
 * linked order's own order_number takes priority over the ticket's
 * free-text order_reference, since the former is confirmed data and the
 * latter is whatever the customer typed. Falls back to null (no
 * reference at all) when neither is available -- never invents one.
 */
export function resolveWhatsAppOrderReference(orderContext: OrderContextState, supportRequest: SupportRequest): string | null {
  if (orderContext.status === 'ready') return orderContext.order.order_number ?? null;
  return supportRequest.orderReference ?? null;
}

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
          <p className="mt-1 text-xs text-slate-500">
            {SUPPORT_TOPIC_LABELS[supportRequest.topic]} · {SUPPORT_SOURCE_LABELS[supportRequest.source]} · Creado el {formatOrderDate(supportRequest.createdAt)}
          </p>
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
            <div className="flex gap-2">
              <dt className="text-slate-500">Teléfono:</dt>
              <dd className="font-medium text-slate-900">{supportRequest.customerPhone || 'No informado'}</dd>
            </div>
            {supportRequest.orderReference ? (
              <div className="flex gap-2">
                <dt className="text-slate-500">Nº de pedido (texto libre):</dt>
                <dd className="font-medium text-slate-900">{supportRequest.orderReference}</dd>
              </div>
            ) : null}
            {supportRequest.requestKind === 'withdrawal' ? (
              <>
                <div className="flex gap-2">
                  <dt className="text-slate-500">Código de trámite:</dt>
                  <dd className="font-mono font-semibold text-slate-900">{supportRequest.requestCode}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-slate-500">Respuesta antes de:</dt>
                  <dd className="font-medium text-slate-900">{supportRequest.responseDueAt ? formatOrderDate(supportRequest.responseDueAt) : 'No informado'}</dd>
                </div>
              </>
            ) : null}
          </dl>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <WhatsAppContactButton
              key={supportRequest.id}
              phone={supportRequest.customerPhone}
              defaultMessage={buildSupportWhatsAppMessage(supportRequest.customerName, resolveWhatsAppOrderReference(orderContext, supportRequest))}
            />
            <GmailContactLink email={supportRequest.customerEmail} customerName={supportRequest.customerName} subject={supportRequest.subject} />
          </div>
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
          {allowedTransitions.map((next) => {
            const iconConfig = STATUS_ACTION_ICON[next];
            if (iconConfig) {
              return (
                <AdminIconButton
                  key={next}
                  icon={iconConfig.icon}
                  label={supportStatusActionLabel(next)}
                  accessibleLabel={`${supportStatusActionLabel(next)} consulta`}
                  tone={iconConfig.tone}
                  size="sm"
                  disabled={statusSaving}
                  onClick={() => onChangeStatus(next)}
                />
              );
            }
            return (
              <AdminSecondaryButton key={next} size="sm" disabled={statusSaving} onClick={() => onChangeStatus(next)}>
                {supportStatusActionLabel(next)}
              </AdminSecondaryButton>
            );
          })}
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
