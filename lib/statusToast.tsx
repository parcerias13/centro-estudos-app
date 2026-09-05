'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

type StatusToastState = { tipo: 'success' | 'error'; mensagem: string } | null;

/**
 * Toast genérico de sucesso/erro, para substituir alert() nativo.
 * Extensão do padrão já usado no toast de check-in do Dashboard
 * (mesma pílula fixa no fundo do ecrã, mesmo ícone/cor por estado).
 */
export function useStatusToast(duracaoMs = 4000) {
  const [toast, setToast] = useState<StatusToastState>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (tipo: 'success' | 'error', mensagem: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast({ tipo, mensagem });
    timeoutRef.current = setTimeout(() => setToast(null), duracaoMs);
  };

  const showError = (mensagem: string) => showToast('error', mensagem);
  const showSuccess = (mensagem: string) => showToast('success', mensagem);

  return { toast, showToast, showError, showSuccess };
}

export function StatusToast({ toast, offset = false }: { toast: StatusToastState; offset?: boolean }) {
  if (!toast) return null;
  const isError = toast.tipo === 'error';
  return (
    <div
      className={`fixed ${offset ? 'bottom-24' : 'bottom-6'} left-1/2 -translate-x-1/2 z-[60] bg-surface border rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-2.5 animate-in slide-in-from-bottom duration-200 ${
        isError ? 'border-danger/40' : 'border-success/40'
      }`}
    >
      {isError ? (
        <XCircle size={16} className="shrink-0 text-danger" />
      ) : (
        <CheckCircle2 size={16} className="shrink-0 text-success" />
      )}
      <p className={`text-sm font-bold ${isError ? 'text-danger' : 'text-success'}`}>{toast.mensagem}</p>
    </div>
  );
}
