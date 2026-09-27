import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// Shared across every admin page (provided once in AdminLayout) so a page
// with an open, unsaved form can stop the sidebar from silently discarding
// it, and the browser's own beforeunload prompt covers tab close/refresh.
// Pages that never register unsaved changes (the default) are completely
// unaffected -- this only intercepts anything when a page opts in.
//
// Dirty state is tracked per source key (e.g. 'hero', 'about', 'products')
// because "Editar pagina" renders two independently-saveable forms on the
// same route: either one being dirty must block navigation, and saving one
// must not clear the other's pending changes.
type UnsavedChangesContextValue = {
  isDirty: boolean;
  /** Registers whether a given source currently has unsaved changes. */
  setDirty: (key: string, dirty: boolean) => void;
  /** Returns true if it is safe to proceed (no unsaved changes, or the user confirmed discarding them). */
  confirmDiscardIfDirty: () => boolean;
};

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

/** True if any registered source is dirty. Exported standalone so the OR-aggregation across independently-saveable blocks (e.g. Portada + Acerca de Rehabex) is unit-testable without mounting the provider. */
export function anyDirty(dirtyKeys: Record<string, boolean>): boolean {
  return Object.values(dirtyKeys).some(Boolean);
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirtyKeys, setDirtyKeys] = useState<Record<string, boolean>>({});
  const isDirty = useMemo(() => anyDirty(dirtyKeys), [dirtyKeys]);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const setDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((prev) => {
      if (Boolean(prev[key]) === dirty) return prev;
      return { ...prev, [key]: dirty };
    });
  }, []);

  const confirmDiscardIfDirty = useCallback(() => {
    if (!isDirtyRef.current) return true;
    return window.confirm('Tenés cambios sin guardar. Si continuás, se van a perder. ¿Querés continuar igual?');
  }, []);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Browser back/forward button: React Router's plain <Routes> setup has no
  // data-router blocker available (useBlocker requires createBrowserRouter),
  // so this guards the native history instead. While dirty, a sentinel entry
  // is kept on top of the stack; a back press pops it and fires popstate
  // here first, letting us confirm before letting the navigation through.
  useEffect(() => {
    if (!isDirty) return;
    window.history.pushState({ __unsavedGuard: true }, '');
    const handlePopState = () => {
      if (confirmDiscardIfDirty()) {
        window.history.back();
      } else {
        window.history.pushState({ __unsavedGuard: true }, '');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isDirty, confirmDiscardIfDirty]);

  return (
    <UnsavedChangesContext.Provider value={{ isDirty, setDirty, confirmDiscardIfDirty }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges(): UnsavedChangesContextValue {
  const context = useContext(UnsavedChangesContext);
  if (!context) throw new Error('useUnsavedChanges must be used within an UnsavedChangesProvider');
  return context;
}
