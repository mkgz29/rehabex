import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

// Shared across every admin page (provided once in AdminLayout) so a page
// with an open, unsaved form can stop the sidebar from silently discarding
// it, and the browser's own beforeunload prompt covers tab close/refresh.
// Pages that never register unsaved changes (the default) are completely
// unaffected -- this only intercepts anything when a page opts in.
type UnsavedChangesContextValue = {
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
  /** Returns true if it is safe to proceed (no unsaved changes, or the user confirmed discarding them). */
  confirmDiscardIfDirty: () => boolean;
};

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const confirmDiscardIfDirty = useCallback(() => {
    if (!isDirty) return true;
    return window.confirm('Tenés cambios sin guardar. Si continuás, se van a perder. ¿Querés continuar igual?');
  }, [isDirty]);

  return (
    <UnsavedChangesContext.Provider value={{ isDirty, setDirty: setIsDirty, confirmDiscardIfDirty }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges(): UnsavedChangesContextValue {
  const context = useContext(UnsavedChangesContext);
  if (!context) throw new Error('useUnsavedChanges must be used within an UnsavedChangesProvider');
  return context;
}
