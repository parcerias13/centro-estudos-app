'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { EMAIL_RELATORIO_ATIVO } from '@/lib/features';
import {
  mesAnteriorPorOmissao, intervaloDoMes, calcularMetricasMes,
  construirPayloadRelatorioMensal, type MetricasMes,
} from '@/lib/relatorio';
import {
  FileBarChart, Loader2, Send, CheckCircle2, XCircle, Clock, Mail, MailWarning,
  RotateCcw, Eye,
} from 'lucide-react';

type EstadoAluno = 'pronto' | 'sem_dados' | 'ja_enviado';

type LinhaAluno = {
  id: string;
  nome: string;
  ano_escolar: number | null;
  email_encarregado: string | null;
  estado: EstadoAluno;
};

type ResultadoEnvio = { status: 'enviado' | 'ja_existia' | 'falhou'; motivo?: string };

const TAMANHO_LOTE = 4;

function nomeMes(mes: number) {
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return nomes[mes - 1] ?? String(mes);
}

async function processarEmLotes<T>(itens: T[], tamanhoLote: number, worker: (item: T) => Promise<void>) {
  for (let i = 0; i < itens.length; i += tamanhoLote) {
    const lote = itens.slice(i, i + tamanhoLote);
    await Promise.all(lote.map(worker));
  }
}

export default function RelatorioMensalPage() {
  const { toast, showError, showSuccess } = useStatusToast();

  const [centroId, setCentroId] = useState<string | null>(null);
  const [loadingPagina, setLoadingPagina] = useState(true);
  const [loadingLista, setLoadingLista] = useState(false);

  const { ano: anoInicial, mes: mesInicial } = mesAnteriorPorOmissao();
  const [ano, setAno] = useState(anoInicial);
  const [mes, setMes] = useState(mesInicial);

  const [linhas, setLinhas] = useState<LinhaAluno[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [alunoPreview, setAlunoPreview] = useState<string | null>(null);
  const [previewMetricas, setPreviewMetricas] = useState<MetricasMes | null>(null);
  const [carregandoPreview, setCarregandoPreview] = useState(false);

  const [aConfirmar, setAConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState({ total: 0, concluidos: 0 });
  const [resultados, setResultados] = useState<Map<string, ResultadoEnvio>>(new Map());
  const [resumoVisivel, setResumoVisivel] = useState(false);

  const isFetchingRef = useRef(false);
  const fetchPendingRef = useRef(false);

  // Isolamento por centro: nunca cargar nem enviar sem saber o centro_id da
  // sessão — vem sempre de app_metadata, nunca é escolhido na página.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCentroId(user?.app_metadata?.centro_id ?? null);
      setLoadingPagina(false);
    });
  }, []);

  const carregarLista = useCallback(async (centro_id: string, anoAlvo: number, mesAlvo: number) => {
    if (isFetchingRef.current) {
      fetchPendingRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    setLoadingLista(true);
    try {
      const { data: alunosData, error: erroAlunos } = await supabase
        .from('alunos')
        .select('id, nome, ano_escolar, email_encarregado')
        .eq('centro_id', centro_id)
        .eq('ativo', true)
        .order('nome');

      if (erroAlunos) {
        showError('Não foi possível carregar os alunos: ' + erroAlunos.message);
        return;
      }

      const alunos = alunosData || [];
      const alunoIds = alunos.map((a) => a.id);
      if (alunoIds.length === 0) {
        setLinhas([]);
        setSelecionados(new Set());
        return;
      }

      const { inicioISO, fimISO } = intervaloDoMes(anoAlvo, mesAlvo);
      const inicioData = inicioISO.slice(0, 10);
      const fimData = fimISO.slice(0, 10);

      const [
        { data: jaEnviados, error: erroEnviados },
        { data: presencas, error: erroPresencas },
        { data: explicacoesDoMes, error: erroExplicacoes },
        { data: notas, error: erroNotas },
      ] = await Promise.all([
        supabase.from('mensagens').select('aluno_id').eq('centro_id', centro_id).eq('tipo', 'relatorio_mensal').eq('payload->>ano', String(anoAlvo)).eq('payload->>mes', String(mesAlvo)).in('aluno_id', alunoIds),
        supabase.from('diario_bordo').select('aluno_id').eq('centro_id', centro_id).gte('entrada', inicioISO).lte('entrada', fimISO),
        supabase.from('explicacoes').select('id').eq('centro_id', centro_id).eq('dado', true).gte('data', inicioData).lte('data', fimData),
        supabase.from('exams').select('aluno_id').eq('centro_id', centro_id).not('nota_valor', 'is', null).gte('date', inicioData).lte('date', fimData),
      ]);

      if (erroEnviados || erroPresencas || erroExplicacoes || erroNotas) {
        showError('Não foi possível carregar o estado do mês: ' + (erroEnviados || erroPresencas || erroExplicacoes || erroNotas)!.message);
        return;
      }

      let alunosComExplicacao: string[] = [];
      const explicacaoIds = (explicacoesDoMes || []).map((e) => e.id);
      if (explicacaoIds.length > 0) {
        const { data: ea, error: erroEa } = await supabase.from('explicacoes_alunos').select('aluno_id').in('explicacao_id', explicacaoIds);
        if (erroEa) { showError('Não foi possível carregar explicações do mês: ' + erroEa.message); return; }
        alunosComExplicacao = (ea || []).map((x) => x.aluno_id);
      }

      const enviadosSet = new Set((jaEnviados || []).map((m) => m.aluno_id));
      const temDadosSet = new Set<string>([
        ...(presencas || []).map((p) => p.aluno_id),
        ...alunosComExplicacao,
        ...(notas || []).map((n) => n.aluno_id),
      ]);

      const novasLinhas: LinhaAluno[] = alunos.map((a) => ({
        id: a.id,
        nome: a.nome,
        ano_escolar: a.ano_escolar,
        email_encarregado: a.email_encarregado,
        estado: enviadosSet.has(a.id) ? 'ja_enviado' : temDadosSet.has(a.id) ? 'pronto' : 'sem_dados',
      }));

      setLinhas(novasLinhas);
      // Seleção por omissão: "pronto" vem marcado; "sem dados" vem
      // desmarcado (o admin decide à mão); "já enviado" nunca é selecionável.
      setSelecionados(new Set(novasLinhas.filter((l) => l.estado === 'pronto').map((l) => l.id)));
      setResultados(new Map());
      setResumoVisivel(false);
    } finally {
      isFetchingRef.current = false;
      setLoadingLista(false);
      if (fetchPendingRef.current) {
        fetchPendingRef.current = false;
        carregarLista(centro_id, anoAlvo, mesAlvo);
      }
    }
  }, [showError]);

  useEffect(() => {
    if (centroId) carregarLista(centroId, ano, mes);
    // carregarLista não entra nas deps de propósito: a sua identidade muda a
    // cada render (depende de showError, que o useStatusToast recria sempre)
    // — incluí-la aqui causava um ciclo de pedidos sem fim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroId, ano, mes]);

  const handleMudarMes = (valor: string) => {
    const [a, m] = valor.split('-').map(Number);
    if (!a || !m) return;
    setAno(a);
    setMes(m);
    setAlunoPreview(null);
    setPreviewMetricas(null);
    setAConfirmar(false);
  };

  const toggleSelecionado = (id: string) => {
    setSelecionados((atual) => {
      const copia = new Set(atual);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  };

  const abrirPreview = async (alunoId: string) => {
    setAlunoPreview(alunoId);
    setCarregandoPreview(true);
    try {
      const metricas = await calcularMetricasMes(supabase, alunoId, ano, mes);
      setPreviewMetricas(metricas);
    } catch (e: any) {
      showError('Não foi possível calcular a pré-visualização: ' + (e?.message || 'erro inesperado'));
      setPreviewMetricas(null);
    } finally {
      setCarregandoPreview(false);
    }
  };

  const enviarParaAluno = async (alunoId: string): Promise<ResultadoEnvio> => {
    try {
      const metricas = await calcularMetricasMes(supabase, alunoId, ano, mes);
      const payload = construirPayloadRelatorioMensal(ano, mes, metricas);
      // .select() depois do insert — apanha um silêncio da RLS (sem erro,
      // sem linha devolvida) em vez de assumir sucesso por não haver erro.
      const { data, error } = await supabase.from('mensagens').insert({ aluno_id: alunoId, tipo: 'relatorio_mensal', payload }).select();
      if (error) {
        // 23505 = já existe um relatorio_mensal deste aluno/ano/mês (índice
        // único) — nunca é uma falha, é o resultado esperado de reenviar.
        if (error.code === '23505') return { status: 'ja_existia' };
        return { status: 'falhou', motivo: error.message };
      }
      if (!data || data.length === 0) return { status: 'falhou', motivo: 'A escrita não foi confirmada pelo servidor.' };
      return { status: 'enviado' };
    } catch (e: any) {
      return { status: 'falhou', motivo: e?.message || 'Erro inesperado.' };
    }
  };

  const avisarPorEmail = async (alunoIds: string[]) => {
    if (!EMAIL_RELATORIO_ATIVO || alunoIds.length === 0) return;
    try {
      await fetch('/api/admin/relatorio-mensal/avisar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ano, mes, alunoIds }),
      });
    } catch {
      // O email é um passo à parte — uma falha aqui nunca desfaz nem
      // invalida as mensagens já criadas.
    }
  };

  const executarEnvio = async (idsAlvo: string[]) => {
    if (idsAlvo.length === 0) return;
    setEnviando(true);
    setProgresso({ total: idsAlvo.length, concluidos: 0 });
    const novosResultados = new Map(resultados);

    await processarEmLotes(idsAlvo, TAMANHO_LOTE, async (alunoId) => {
      const resultado = await enviarParaAluno(alunoId);
      novosResultados.set(alunoId, resultado);
      setResultados(new Map(novosResultados));
      setProgresso((atual) => ({ ...atual, concluidos: atual.concluidos + 1 }));
    });

    const enviadosAgora = idsAlvo.filter((id) => novosResultados.get(id)?.status === 'enviado');
    await avisarPorEmail(enviadosAgora);

    setEnviando(false);
    setResumoVisivel(true);
    setAConfirmar(false);
    // Os que acabaram de ser enviados passam a "já enviado" na lista.
    setLinhas((atual) => atual.map((l) => (enviadosAgora.includes(l.id) ? { ...l, estado: 'ja_enviado' } : l)));
    showSuccess(`Envio concluído: ${enviadosAgora.length} enviado(s).`);
  };

  const handleEnviarSelecionados = () => executarEnvio(Array.from(selecionados));

  const handleRepetirFalhados = () => {
    const falhados = Array.from(resultados.entries()).filter(([, r]) => r.status === 'falhou').map(([id]) => id);
    executarEnvio(falhados);
  };

  if (loadingPagina) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  const totalSelecionados = selecionados.size;
  const resumo = {
    enviados: Array.from(resultados.values()).filter((r) => r.status === 'enviado').length,
    jaExistiam: Array.from(resultados.values()).filter((r) => r.status === 'ja_existia').length,
    falhados: Array.from(resultados.entries()).filter(([, r]) => r.status === 'falhou'),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-primary flex items-center gap-2">
          <FileBarChart className="text-accent" /> Relatório Mensal
        </h1>
        <p className="text-secondary text-sm">Envia o relatório do mês para a conversa de cada aluno, em lote.</p>
      </div>

      <div className="bg-surface border border-border rounded-3xl shadow-xl p-6 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <label className="text-[10px] font-black uppercase text-muted tracking-widest">Mês</label>
            <input
              type="month"
              value={`${ano}-${String(mes).padStart(2, '0')}`}
              onChange={(e) => handleMudarMes(e.target.value)}
              disabled={enviando}
              className="block mt-1 bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent transition-all disabled:opacity-50"
            />
          </div>
          <p className="text-sm text-secondary font-bold">{nomeMes(mes)} de {ano}</p>
        </div>

        {loadingLista ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-accent" /></div>
        ) : linhas.length === 0 ? (
          <p className="text-muted text-sm text-center italic py-10">Nenhum aluno ativo neste centro.</p>
        ) : (
          <div className="border border-border rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-page text-muted uppercase text-[10px] font-black tracking-widest">
                <tr>
                  <th className="p-3 text-left w-10"></th>
                  <th className="p-3 text-left">Nome</th>
                  <th className="p-3 text-left">Ano</th>
                  <th className="p-3 text-left">Estado</th>
                  <th className="p-3 text-left">Email encarregado</th>
                  <th className="p-3 text-left w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {linhas.map((l) => (
                  <tr key={l.id} className="text-secondary">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selecionados.has(l.id)}
                        disabled={l.estado === 'ja_enviado' || enviando}
                        onChange={() => toggleSelecionado(l.id)}
                        className="accent-blue-600"
                      />
                    </td>
                    <td className="p-3 font-bold text-primary">{l.nome}</td>
                    <td className="p-3">{l.ano_escolar ? `${l.ano_escolar}º` : '—'}</td>
                    <td className="p-3">
                      {l.estado === 'ja_enviado' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-accent-soft text-accent"><CheckCircle2 size={11} /> Já enviado</span>
                      )}
                      {l.estado === 'sem_dados' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-warning-bg text-warning"><Clock size={11} /> Sem dados no mês</span>
                      )}
                      {l.estado === 'pronto' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-success-bg text-success"><CheckCircle2 size={11} /> Pronto</span>
                      )}
                      {resultados.has(l.id) && (
                        <span className={`ml-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                          resultados.get(l.id)!.status === 'falhou' ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success'
                        }`} title={resultados.get(l.id)!.motivo}>
                          {resultados.get(l.id)!.status === 'falhou' ? <XCircle size={11} /> : <CheckCircle2 size={11} />}
                          {resultados.get(l.id)!.status === 'enviado' ? 'Enviado' : resultados.get(l.id)!.status === 'ja_existia' ? 'Já existia' : 'Falhou'}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {l.email_encarregado ? (
                        <span className="inline-flex items-center gap-1 text-success text-xs"><Mail size={12} /> tem</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-danger text-xs"><MailWarning size={12} /> sem email</span>
                      )}
                    </td>
                    <td className="p-3">
                      <button onClick={() => abrirPreview(l.id)} className="text-muted hover:text-accent transition-colors" title="Pré-visualizar cartão">
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {alunoPreview && (
          <div className="bg-page border border-border rounded-2xl p-5 max-w-sm">
            <p className="text-[10px] font-black uppercase text-muted tracking-widest mb-3">Pré-visualização do cartão</p>
            {carregandoPreview ? (
              <Loader2 className="animate-spin text-accent" size={20} />
            ) : previewMetricas ? (
              <div className="bg-accent text-on-accent rounded-2xl p-4 shadow-lg space-y-2 max-w-[260px]">
                <div className="flex items-center gap-2"><FileBarChart size={16} /><p className="font-black text-xs uppercase tracking-widest">Relatório Mensal</p></div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <p className="opacity-80">Período: <span className="font-bold">{String(mes).padStart(2, '0')}/{ano}</span></p>
                  <p className="opacity-80">Horas: <span className="font-bold">{previewMetricas.totalHoras}</span></p>
                  <p className="opacity-80">Sessões: <span className="font-bold">{previewMetricas.totalSessoes}</span></p>
                  {previewMetricas.disciplinaPrincipal !== '-' && (
                    <p className="opacity-80 col-span-2">Disciplina: <span className="font-bold">{previewMetricas.disciplinaPrincipal}</span></p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-muted text-sm italic">Sem dados para pré-visualizar.</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4 border-t border-border pt-5">
          {enviando && (
            <div className="space-y-2">
              <div className="h-2 bg-page rounded-full overflow-hidden">
                <div className="h-full bg-accent transition-all" style={{ width: `${progresso.total > 0 ? (progresso.concluidos / progresso.total) * 100 : 0}%` }} />
              </div>
              <p className="text-xs text-muted font-bold">{progresso.concluidos} / {progresso.total}</p>
            </div>
          )}

          {!aConfirmar ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAConfirmar(true)}
                disabled={totalSelecionados === 0 || enviando}
                className="bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-on-accent px-6 py-3 rounded-2xl font-black flex items-center gap-2 transition-all active:scale-95"
              >
                <Send size={18} /> Enviar a {totalSelecionados} família{totalSelecionados === 1 ? '' : 's'}
              </button>
              {resumo.falhados.length > 0 && !enviando && (
                <button
                  onClick={handleRepetirFalhados}
                  className="bg-surface border border-border hover:bg-raised text-primary px-6 py-3 rounded-2xl font-black flex items-center gap-2 transition-all active:scale-95"
                >
                  <RotateCcw size={18} /> Repetir {resumo.falhados.length} falhado(s)
                </button>
              )}
            </div>
          ) : (
            <div className="bg-warning-bg border border-warning/30 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-bold text-primary">Enviar o relatório de {nomeMes(mes)}/{ano} a {totalSelecionados} família{totalSelecionados === 1 ? '' : 's'}?</p>
              <div className="flex gap-2">
                <button onClick={() => setAConfirmar(false)} disabled={enviando} className="px-4 py-2 rounded-xl font-black text-secondary hover:text-primary transition-colors text-sm">Cancelar</button>
                <button onClick={handleEnviarSelecionados} disabled={enviando} className="bg-accent hover:bg-accent-hover text-on-accent px-5 py-2 rounded-xl font-black text-sm flex items-center gap-2 transition-all active:scale-95">
                  {enviando ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Confirmar envio
                </button>
              </div>
            </div>
          )}

          {resumoVisivel && !enviando && (
            <div className="bg-page border border-border rounded-2xl p-4 text-sm space-y-1">
              <p className="font-black text-primary">Resumo do envio</p>
              <p className="text-success">{resumo.enviados} enviado(s)</p>
              <p className="text-accent">{resumo.jaExistiam} já existente(s)</p>
              {resumo.falhados.length > 0 && (
                <div className="text-danger">
                  <p>{resumo.falhados.length} falhado(s):</p>
                  <ul className="list-disc list-inside">
                    {resumo.falhados.map(([id, r]) => (
                      <li key={id}>{linhas.find((l) => l.id === id)?.nome ?? id}: {r.motivo}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <StatusToast toast={toast} />
    </div>
  );
}
