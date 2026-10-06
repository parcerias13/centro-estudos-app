'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isUnlocked, subscribe } from '@/lib/encarregadoUnlock';
import { ArrowLeft, Loader2, MessageCircle } from 'lucide-react';

// Shell só com a porta de acesso — a conversa completa (listar, enviar,
// marcar como lidas, pedido de explicação, anexos) entra no B3.
export default function MensagensEncarregadoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      if (!isUnlocked(user.id)) { router.replace('/encarregados'); return; }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shell sem dados próprios ainda (chegam no B3) — mas já sai do ecrã
  // assim que lock() acontece, por inatividade, logout, ou Bloquear.
  useEffect(() => {
    const cancelar = subscribe(() => { router.replace('/encarregados'); });
    return cancelar;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-md mx-auto space-y-8 pb-20">
      <Link href="/encarregados" className="flex items-center gap-2 text-muted hover:text-primary transition-colors">
        <ArrowLeft size={20} /> <span className="font-bold">Voltar</span>
      </Link>

      <div className="flex flex-col items-center text-center gap-3 pt-12">
        <div className="bg-accent-soft text-accent p-4 rounded-full">
          <MessageCircle size={28} />
        </div>
        <h1 className="text-xl font-black italic">Mensagens</h1>
        <p className="text-muted text-sm">Em breve.</p>
      </div>
    </main>
  );
}
