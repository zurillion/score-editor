/** Browser-tab title management: "<context> · Score Composer", app default otherwise. */
export const DEFAULT_TITLE = 'Score Composer · Endecalineo';

export function setPageTitle(context?: string | null): void {
  document.title = context && context.trim() ? `${context.trim()} · Score Composer` : DEFAULT_TITLE;
}
