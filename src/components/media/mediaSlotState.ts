// Shared decision logic for any CMS-administrable image slot (public Hero,
// admin ImageField preview). Kept as a pure function, independent of React,
// so every state transition is exercised by a plain unit test rather than
// only inferred from reading JSX.
export type MediaSlotState = 'loading' | 'empty' | 'ready' | 'error';

export function resolveMediaSlotState(params: { isLoading: boolean; url: string; failed: boolean }): MediaSlotState {
  if (params.isLoading) return 'loading';
  if (!params.url) return 'empty';
  if (params.failed) return 'error';
  return 'ready';
}
