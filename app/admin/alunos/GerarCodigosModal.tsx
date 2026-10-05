'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { X, Loader2, KeyRound, AlertTriangle, CheckCircle2, Copy } from 'lucide-react';

interface Props {
  alunos: any[];
  onClose: () => void;
}

type EstadoCodigo = {
  aluno_id: string;
  tem_codigo: boolean;
  definido_por: string | null;
  bloqueado_ate: string | null;
};

type AcessoGerado = { nome: string; codigo: string };

export default function GerarCodigosModal({ alunos, onClose }: Props) {
  const { toast, showError } = useStatusToast();
  const [loading, setLoading] = useState(true);
  const [estadoCodigos, setEstadoCodigos] = useState<EstadoCodigo[]>([]);
  const [gerando, setGerando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [acessosGerados, setAcessosGerados] = useState<AcessoGerado[]>([]);
  const [copiadoTudo, setCopiadoTudo] = useState(false);

  const nomePorAluno = (alunoId: string) => alunos.find((a) => a.id === alunoId)?.nome || 'Desconhecido';

  const carregarEstado = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('estado_codigos_encarregados');
    setLoading(false);
    if (error) {
      showError('Erro ao carregar o estado dos códigos: ' + error.message);
      return;
    }
    // Só alunos que a página já conhece — nunca mostrar ou gerar código para
    // um id que o estado_codigos_encarregados() devolva mas que não esteja
    // na lista carregada (evita a linha "Desconhecido").
    setEstadoCodigos((data || []).filter((e: EstadoCodigo) => alunos.some((a) => a.id === e.aluno_id)));
  };

  useEffect(() => { carregarEstado(); }, []);

  const semCodigo = estadoCodigos.filter((e) => !e.tem_codigo);

  const handleGerarParaTodos = async () => {
    if (semCodigo.length === 0) return;
    setGerando(true);
    setProgresso(0);
    const acessos: AcessoGerado[] = [];

    for (let i = 0; i < semCodigo.length; i++) {
      const item = semCodigo[i];
      try {
        const res = await fetch('/api/admin/gerar-codigo-encarregado', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alunoId: item.aluno_id }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          acessos.push({ nome: nomePorAluno(item.aluno_id), codigo: body.codigo });
        } else {
          showError(`Erro ao gerar código para ${nomePorAluno(item.aluno_id)}: ${body?.error || res.status}`);
        }
      } catch (err: any) {
        showError(`Erro ao gerar código para ${nomePorAluno(item.aluno_id)}: ${err.message}`);
      }
      setProgresso(i + 1);
    }

    setAcessosGerados(acessos);
    setGerando(false);
    await carregarEstado();
  };

  const handleCopiarTudo = async () => {
    const texto = acessosGerados.map((a) => `${a.nome}\t${a.codigo}`).join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      setCopiadoTudo(true);
      setTimeout(() => setCopiadoTudo(false), 3000);
    } catch {
      showError('Não foi possível copiar — a lista fica visível no ecrã para copiares à mão.');
    }
  };

  const badgeEstado = (item: EstadoCodigo) => {
    if (!item.tem_codigo) return <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-danger-bg text-danger rounded-md">Sem código</span>;
    if (item.definido_por === 'familia') return <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-success-bg text-success rounded-md">Alterado pela família</span>;
    return <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-warning-bg text-warning rounded-md">Código inicial</span>;
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <KeyRound className="text-accent" size={22} />
            <h2 className="text-lg font-black text-primary uppercase tracking-tight">Códigos dos Encarregados</h2>
          </div>
          {!gerando && (
            <button onClick={onClose} className="text-muted hover:text-primary transition-colors">
              <X size={22} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-accent" size={32} />
            </div>
          ) : acessosGerados.length > 0 ? (
            <div className="space-y-6">
              <div className="bg-success-bg border border-success/30 p-4 rounded-xl flex items-center gap-3 text-success">
                <CheckCircle2 size={22} />
                <p className="font-black">{acessosGerados.length} código(s) gerado(s) — guarda-os agora, só aparecem uma vez.</p>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleCopiarTudo}
                  className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-on-accent px-4 py-2 rounded-xl font-black text-xs transition-all active:scale-95"
                >
                  <Copy size={14} /> {copiadoTudo ? 'Copiado!' : 'Copiar tudo'}
                </button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-page text-muted uppercase text-[10px] font-black tracking-widest">
                    <tr>
                      <th className="p-3 text-left">Nome</th>
                      <th className="p-3 text-left">Código</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acessosGerados.map((a, i) => (
                      <tr key={i} className="border-t border-border text-secondary">
                        <td className="p-3 font-bold">{a.nome}</td>
                        <td className="p-3 font-mono tracking-[0.2em]">{a.codigo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 bg-page border border-border rounded-xl p-4">
                <AlertTriangle size={20} className={semCodigo.length > 0 ? 'text-warning' : 'text-success'} />
                <p className="font-bold text-sm">
                  {semCodigo.length} de {estadoCodigos.length} aluno(s) sem código dos encarregados.
                </p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-page text-muted uppercase text-[10px] font-black tracking-widest">
                    <tr>
                      <th className="p-3 text-left">Aluno</th>
                      <th className="p-3 text-left">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estadoCodigos.map((item) => (
                      <tr key={item.aluno_id} className="border-t border-border text-secondary">
                        <td className="p-3 font-bold">{nomePorAluno(item.aluno_id)}</td>
                        <td className="p-3">{badgeEstado(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {gerando && (
                <div className="flex items-center justify-center gap-3 text-secondary py-4">
                  <Loader2 className="animate-spin text-accent" size={20} />
                  <p className="font-bold text-sm">A gerar {progresso} / {semCodigo.length}...</p>
                </div>
              )}
            </>
          )}
        </div>

        {acessosGerados.length === 0 && (
          <div className="p-6 border-t border-border flex justify-end gap-3">
            <button onClick={onClose} disabled={gerando} className="px-6 py-3 rounded-xl font-black text-secondary hover:text-primary transition-colors disabled:opacity-50">
              Fechar
            </button>
            <button
              onClick={handleGerarParaTodos}
              disabled={gerando || loading || semCodigo.length === 0}
              className="bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-on-accent px-6 py-3 rounded-2xl font-black transition-all active:scale-95"
            >
              Gerar para Todos ({semCodigo.length})
            </button>
          </div>
        )}
        {acessosGerados.length > 0 && (
          <div className="p-6 border-t border-border flex justify-end">
            <button onClick={onClose} className="bg-accent hover:bg-accent-hover text-on-accent px-6 py-3 rounded-2xl font-black transition-all active:scale-95">
              Concluir
            </button>
          </div>
        )}
      </div>
      <StatusToast toast={toast} />
    </div>
  );
}
