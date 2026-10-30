// Evento leve no window para sincronizar o selo "Alterações" da sidebar
// (app/admin/layout.tsx) com a página de Alterações (app/admin/alteracoes)
// assim que alguém marca alterações como vistas — sem as acoplar uma à
// outra, nenhuma das duas sabe da existência da outra, só deste módulo.
// Mesmo padrão de lib/eventoMensagensAdmin.ts e lib/eventoNotasAdmin.ts.
const EVENTO = 'cognilab:admin-alteracoes-vistas';

export function avisarAlteracoesVistas(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO));
}

export function subscreverAlteracoesVistas(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENTO, callback);
  return () => window.removeEventListener(EVENTO, callback);
}
