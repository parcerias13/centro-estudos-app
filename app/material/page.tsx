'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { dataLisboaDe } from '@/lib/dataLisboa';
import { listarMaterialAluno, obterUrlAssinadaMaterial, marcarMaterialVisto, rotuloCategoriaMaterial, formatarTamanhoFicheiro, type MaterialAluno } from '@/lib/materialAluno';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { ArrowLeft, FolderOpen, Loader2, ExternalLink, FileText } from 'lucide-react';

function formatarDataCurta(dataISO: string): string {
  return format(new Date(`${dataISO}T00:00:00`), "d 'de' MMM", { locale: pt });
}

export default function MaterialAlunoPage() {
  const { toast, showError } = useStatusToast();
  const [loading, setLoading] = useState(true);
  const [materiais, setMateriais] = useState<MaterialAluno[]>([]);
  const [abrindoId, setAbrindoId] = useState<string | null>(null);

  const carregar = useCallback(async (alunoId: string) => {
    setLoading(true);
    try {
      const lista = await listarMaterialAluno(supabase, alunoId);
      setMateriais(lista);
    } catch (e: any) {
      showError('Erro ao carregar o teu material: ' + e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return; }
      carregar(user.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAbrir = (material: MaterialAluno) => {
    if (abrindoId) return;
    // Separador aberto de forma SÍNCRONA dentro do clique, antes de qualquer
    // await — Safari bloqueia window.open() depois de um await, mesmo dentro
    // de um handler de clique. Se o browser bloquear mesmo assim (devolve
    // null), navega no mesmo separador em vez de mostrar erro.
    const novaJanela = window.open('', '_blank');
    if (novaJanela) { try { novaJanela.opener = null; } catch {} }
    setAbrindoId(material.id);
    (async () => {
      try {
        const { url, erro } = await obterUrlAssinadaMaterial(supabase, material.caminho);
        if (!url) {
          novaJanela?.close();
          showError('Não foi possível abrir o ficheiro: ' + erro);
          return;
        }
        if (novaJanela) {
          novaJanela.location.href = url;
        } else {
          window.location.href = url;
        }

        if (!material.visto_em) {
          try {
            await marcarMaterialVisto(supabase, material.id);
            setMateriais((atual) => atual.map((m) => (m.id === material.id ? { ...m, visto_em: m.visto_em ?? new Date().toISOString() } : m)));
          } catch {
            // Falha a marcar como visto não deve impedir o ficheiro de abrir.
          }
        }
      } catch (e: any) {
        novaJanela?.close();
        showError('Não foi possível abrir o ficheiro: ' + (e?.message || 'erro inesperado'));
      } finally {
        setAbrindoId(null);
      }
    })();
  };

  if (loading) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <main className="min-h-screen bg-page text-primary p-6 pb-20 font-sans">
      <div className="max-w-xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors group">
            <ArrowLeft size={20} className="text-secondary group-hover:text-primary transition-colors" />
          </Link>
          <div className="text-right">
            <h1 className="text-2xl font-black italic tracking-tighter text-primary">O MEU MATERIAL</h1>
            <p className="text-[10px] font-black uppercase text-accent tracking-widest">Fichas, resumos e apontamentos</p>
          </div>
        </header>

        {materiais.length === 0 ? (
          <div className="text-center py-16 bg-surface/70 rounded-[2.5rem] border border-border border-dashed">
            <FolderOpen size={48} className="mx-auto mb-4 text-muted" />
            <p className="text-muted font-bold text-sm">Ainda não tens material.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {materiais.map((m) => (
              <div key={m.id} data-material-aluno={m.id} className="bg-surface border border-border rounded-3xl p-5 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="bg-accent-soft text-accent p-2.5 rounded-xl shrink-0"><FileText size={18} /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-primary break-words">{m.titulo}</p>
                      <p className="text-[10px] text-muted font-black uppercase tracking-widest mt-0.5">
                        {rotuloCategoriaMaterial(m.categoria)} · {formatarDataCurta(dataLisboaDe(m.criado_em))} · {formatarTamanhoFicheiro(m.tamanho)}
                      </p>
                    </div>
                  </div>
                  {!m.visto_em && (
                    <span className="shrink-0 bg-accent text-on-accent text-[8px] font-black px-2 py-1 rounded-full uppercase tracking-widest">Novo</span>
                  )}
                </div>

                {m.nota && <p className="text-xs text-secondary break-words">{m.nota}</p>}

                <button
                  onClick={() => handleAbrir(m)}
                  disabled={abrindoId === m.id}
                  className="w-full min-h-11 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-on-accent px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                >
                  {abrindoId === m.id ? <Loader2 className="animate-spin" size={14} /> : <ExternalLink size={14} />} Abrir
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <StatusToast toast={toast} />
    </main>
  );
}
