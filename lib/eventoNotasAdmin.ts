// Evento leve no window para sincronizar o badge "Notas" da sidebar
// (app/admin/layout.tsx) com a página de Notas (app/admin/notas) assim que
// alguém confirma uma nota — sem as acoplar uma à outra, nenhuma das duas
// sabe da existência da outra, só deste módulo. Mesmo padrão de
// lib/eventoMensagensAdmin.ts.
const EVENTO = 'cognilab:admin-notas-confirmadas';

export function avisarNotasConfirmadas(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO));
}

export function subscreverNotasConfirmadas(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENTO, callback);
  return () => window.removeEventListener(EVENTO, callback);
}
