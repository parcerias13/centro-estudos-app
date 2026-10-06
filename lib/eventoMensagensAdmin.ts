// Evento leve no window para sincronizar o badge "Mensagens" da sidebar
// (app/admin/layout.tsx) com a página de Mensagens (app/admin/mensagens)
// assim que o admin marca conversas como lidas — sem as acoplar uma à
// outra, nenhuma das duas sabe da existência da outra, só deste módulo.
const EVENTO = 'cognilab:admin-mensagens-lidas';

export function avisarMensagensLidas(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO));
}

export function subscreverMensagensLidas(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENTO, callback);
  return () => window.removeEventListener(EVENTO, callback);
}
