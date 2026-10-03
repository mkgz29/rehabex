import { useEffect, useState } from 'react';

import {
  AdminApiError,
  getOrderById,
  getSupportRequest,
  listSupportRequests,
  updateSupportRequestNotes,
  updateSupportRequestStatus,
  type SupportRequest,
  type SupportRequestStatus,
} from '../../services/adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { AdminPrimaryButton } from '../components/AdminButton';
import { NewSupportRequestForm } from '../components/NewSupportRequestForm';
import { SupportRequestList } from '../components/SupportRequestList';
import { SupportRequestDetail, type OrderContextState } from '../components/SupportRequestDetail';
import type { SupportStatusFilter } from '../support/supportPresentation';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';

function messageForApiError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function isConflict(error: unknown): boolean {
  return error instanceof AdminApiError && error.kind === 'conflict';
}

function replaceInList(items: SupportRequest[], updated: SupportRequest): SupportRequest[] {
  return items.map((item) => (item.id === updated.id ? updated : item));
}

export function AdminSupportPage() {
  const [filter, setFilter] = useState<SupportStatusFilter>('all');
  const [items, setItems] = useState<SupportRequest[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [orderContext, setOrderContext] = useState<OrderContextState>({ status: 'idle' });
  const [statusSaving, setStatusSaving] = useState(false);

  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);

  const [isCreating, setIsCreating] = useState(false);

  const { setDirty, confirmDiscardIfDirty } = useUnsavedChanges();

  const loadList = async (nextFilter: SupportStatusFilter) => {
    setItems(null);
    setListError(null);
    try {
      const result = await listSupportRequests(nextFilter === 'all' ? undefined : nextFilter);
      setItems(result);
    } catch (error) {
      setItems([]);
      setListError(messageForApiError(error, 'No pudimos cargar las consultas.'));
    }
  };

  useEffect(() => {
    void loadList(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const notesDirty = detail !== null && notesDraft !== (detail.internalNotes ?? '');
  useEffect(() => setDirty('soporte-notas', notesDirty), [notesDirty, setDirty]);
  useEffect(() => () => setDirty('soporte-notas', false), [setDirty]);

  const loadOrderContext = async (orderId: string) => {
    setOrderContext({ status: 'loading' });
    try {
      const order = await getOrderById(orderId);
      setOrderContext(order ? { status: 'ready', order } : { status: 'not_found' });
    } catch (error) {
      setOrderContext({ status: 'error', message: messageForApiError(error, 'No pudimos cargar el pedido.') });
    }
  };

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setActionError(null);
    setConflict(false);
    setOrderContext({ status: 'idle' });
    setDetailLoading(true);
    try {
      const fresh = await getSupportRequest(id);
      setDetail(fresh);
      setNotesDraft(fresh.internalNotes ?? '');
      if (fresh.orderId) void loadOrderContext(fresh.orderId);
    } catch (error) {
      setDetailError(messageForApiError(error, 'No pudimos cargar la consulta.'));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSelect = (id: string) => {
    if (id === selectedId) return;
    if (!confirmDiscardIfDirty()) return;
    void openDetail(id);
  };

  const handleBack = () => {
    if (!confirmDiscardIfDirty()) return;
    setDirty('soporte-notas', false);
    setSelectedId(null);
    setDetail(null);
  };

  const applyUpdatedDetail = (updated: SupportRequest) => {
    setDetail(updated);
    setNotesDraft(updated.internalNotes ?? '');
    setItems((current) => (current ? replaceInList(current, updated) : current));
  };

  const handleChangeStatus = async (next: SupportRequestStatus) => {
    if (!detail) return;
    setStatusSaving(true);
    setActionError(null);
    try {
      const updated = await updateSupportRequestStatus(detail.id, next, detail.updatedAt);
      setConflict(false);
      applyUpdatedDetail(updated);
    } catch (error) {
      if (isConflict(error)) {
        setConflict(true);
        try {
          const fresh = await getSupportRequest(detail.id);
          applyUpdatedDetail(fresh);
        } catch (refreshError) {
          setActionError(messageForApiError(refreshError, 'No pudimos actualizar la consulta.'));
        }
      } else {
        setActionError(messageForApiError(error, 'No pudimos cambiar el estado.'));
      }
    } finally {
      setStatusSaving(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!detail) return;
    setNotesSaving(true);
    setActionError(null);
    try {
      const updated = await updateSupportRequestNotes(detail.id, notesDraft.trim() || null, detail.updatedAt);
      setConflict(false);
      applyUpdatedDetail(updated);
    } catch (error) {
      if (isConflict(error)) {
        setConflict(true);
        try {
          const fresh = await getSupportRequest(detail.id);
          applyUpdatedDetail(fresh);
        } catch (refreshError) {
          setActionError(messageForApiError(refreshError, 'No pudimos guardar la nota.'));
        }
      } else {
        setActionError(messageForApiError(error, 'No pudimos guardar la nota.'));
      }
    } finally {
      setNotesSaving(false);
    }
  };

  const handleCreated = (created: SupportRequest) => {
    setIsCreating(false);
    setFilter('all');
    setItems((current) => [created, ...(current ?? [])]);
    setSelectedId(created.id);
    setDetail(created);
    setNotesDraft(created.internalNotes ?? '');
    setOrderContext(created.orderId ? { status: 'loading' } : { status: 'idle' });
    if (created.orderId) void loadOrderContext(created.orderId);
  };

  const openCreateForm = () => {
    if (!confirmDiscardIfDirty()) return;
    setIsCreating(true);
  };

  const closeCreateForm = () => setIsCreating(false);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Soporte"
        description="Gestioná consultas y seguimiento de clientes."
        actions={!isCreating ? <AdminPrimaryButton onClick={openCreateForm}>Nueva consulta</AdminPrimaryButton> : null}
      />

      {isCreating ? (
        <NewSupportRequestForm onCreated={handleCreated} onCancel={closeCreateForm} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
          <div className={selectedId ? 'hidden lg:block' : 'block'}>
            <SupportRequestList
              items={items}
              error={listError}
              onRetry={() => void loadList(filter)}
              filter={filter}
              onFilterChange={setFilter}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          </div>
          <div className={selectedId ? 'block' : 'hidden lg:block'}>
            <SupportRequestDetail
              supportRequest={detail}
              loading={detailLoading}
              error={detailError}
              conflict={conflict}
              orderContext={orderContext}
              onChangeStatus={(next) => void handleChangeStatus(next)}
              statusSaving={statusSaving}
              notesDraft={notesDraft}
              onNotesDraftChange={setNotesDraft}
              onSaveNotes={() => void handleSaveNotes()}
              notesSaving={notesSaving}
              notesDirty={notesDirty}
              onBack={handleBack}
              actionError={actionError}
            />
          </div>
        </div>
      )}
    </div>
  );
}
