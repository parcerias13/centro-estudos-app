'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa } from '@/lib/dataLisboa';
import {
  buscarAlunosFixosAtivos, diasAteData, rotuloDiasTeste, TESTE_AMBAR_LIMITE_DIAS,
} from '@/lib/osMeusAlunos';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { ArrowLeft, Star, Loader2, Clock, ListTree } from 'lucide-react';

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Segunda-feira, 10 de nov · 15:30" */
function formatarProximaSessaoLabel(dataISO: string, horaInicio: string): string {
  const data = new Date(`${dataISO}T00:00:00`);
  const diaMes = capitalizar(format(data, "EEEE, d 'de' MMM", { locale: pt }));
  return `${diaMes} · ${horaInicio.slice(0, 5)}`;
}

type Cartao = {
  alunoId: string;
  nome: string;
  anoEscolar: number | null;
  disciplinas: string[];
  proximaSessao: { data: string; hora: string } | null;
  proximoTeste: { subjectName: string; date: string } | null;
  ultimaNota: { data: string; notas: string } | null;
};

export default function OsMeusAlunosPage() {
  const { toast, showError } = useStatusToast();
  const hoje = getHojeLisboa();

  const [loadingPagina, setLoadingPagina] = useState(true);
  const [professorId, setProfessorId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setProfessorId(user?.id ?? null);
      setLoadingPagina(false);
    });
  }, []);

  const carregar = useCallback(async (profId: string) => {
    setCarregando(true);
    try {
      const fixos = await buscarAlunosFixosAtivos(supabase, profId, hoje);
      if (fixos.length === 0) {
        setCartoes([]);
        return;
      }

      const serieIds = Array.from(new Set(fixos.flatMap((f) => f.serieIds)));
      const alunoIds = fixos.map((f) => f.alunoId);

      // Só 3 pedidos aqui (+ 1 já feito dentro de buscarAlunosFixosAtivos) —
      // nunca um por cartão, mesmo com muitos alunos fixos.
      const [
        { data: sessoesFuturas, error: errSessoes },
        { data: sessoesComNota, error: errNotas },
        { data: testes, error: errTestes },
      ] = await Promise.all([
        supabase
          .from('explicacoes')
          .select('data, hora_inicio, explicacoes_alunos(aluno_id)')
          .in('serie_id', serieIds)
          .eq('estado', 'ativa')
          .eq('dado', false)
          .gte('data', hoje)
          .order('data', { ascending: true })
          .order('hora_inicio', { ascending: true }),
        supabase
          .from('explicacoes')
          .select('data, notas, explicacoes_alunos(aluno_id)')
          .in('serie_id', serieIds)
          .eq('dado', true)
          .not('notas', 'is', null)
          .order('data', { ascending: false }),
        supabase
          .from('exams')
          .select('aluno_id, subject_name, date')
          .in('aluno_id', alunoIds)
          .gte('date', hoje)
          .order('date', { ascending: true }),
      ]);

      if (errSessoes) throw errSessoes;
      if (errNotas) throw errNotas;
      if (errTestes) throw errTestes;

      const proximaPorAluno = new Map<string, { data: string; hora: string }>();
      for (const s of (sessoesFuturas || []) as any[]) {
        for (const ea of s.explicacoes_alunos || []) {
          if (!proximaPorAluno.has(ea.aluno_id)) {
            proximaPorAluno.set(ea.aluno_id, { data: s.data, hora: s.hora_inicio });
          }
        }
      }

      const notaPorAluno = new Map<string, { data: string; notas: string }>();
      for (const s of (sessoesComNota || []) as any[]) {
        if (!s.notas || !s.notas.trim()) continue;
        for (const ea of s.explicacoes_alunos || []) {
          if (!notaPorAluno.has(ea.aluno_id)) {
            notaPorAluno.set(ea.aluno_id, { data: s.data, notas: s.notas });
          }
        }
      }

      const testePorAluno = new Map<string, { subjectName: string; date: string }>();
      for (const e of (testes || []) as any[]) {
        if (!testePorAluno.has(e.aluno_id)) {
          testePorAluno.set(e.aluno_id, { subjectName: e.subject_name, date: e.date });
        }
      }

      const novosCartoes: Cartao[] = fixos.map((f) => ({
        alunoId: f.alunoId,
        nome: f.nome,
        anoEscolar: f.anoEscolar,
        disciplinas: f.disciplinas,
        proximaSessao: proximaPorAluno.get(f.alunoId) ?? null,
        proximoTeste: testePorAluno.get(f.alunoId) ?? null,
        ultimaNota: notaPorAluno.get(f.alunoId) ?? null,
      }));

      // Pela próxima sessão (mais próxima primeiro); sem sessão marcada, no
      // fim; empates (incluindo "sem sessão" vs "sem sessão") pelo nome.
      novosCartoes.sort((a, b) => {
        const chaveA = a.proximaSessao ? `${a.proximaSessao.data}T${a.proximaSessao.hora}` : null;
        const chaveB = b.proximaSessao ? `${b.proximaSessao.data}T${b.proximaSessao.hora}` : null;
        if (chaveA && chaveB) {
          if (chaveA !== chaveB) return chaveA < chaveB ? -1 : 1;
          return a.nome.localeCompare(b.nome, 'pt');
        }
        if (chaveA) return -1;
        if (chaveB) return 1;
        return a.nome.localeCompare(b.nome, 'pt');
      });

      setCartoes(novosCartoes);
    } catch (e: any) {
      showError('Erro ao carregar os teus alunos: ' + e.message);
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoje]);

  useEffect(() => {
    if (professorId) carregar(professorId);
  }, [professorId, carregar]);

  if (loadingPagina) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <main className="min-h-screen bg-page text-primary p-6 md:p-8 max-w-5xl mx-auto font-sans">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors shrink-0">
          <ArrowLeft size={20} className="text-secondary" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter uppercase flex items-center gap-3 break-words">
            <Star className="text-accent shrink-0" /> Os Meus Alunos
          </h1>
          <p className="text-muted text-[10px] font-black uppercase tracking-widest mt-1">Explicações Fixas</p>
        </div>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-accent" size={32} />
        </div>
      ) : cartoes.length === 0 ? (
        <div className="bg-surface/70 border-2 border-dashed border-border p-12 md:p-16 rounded-[3rem] text-center flex flex-col items-center">
          <Star size={48} className="mb-6 text-muted" />
          <p className="text-muted font-bold text-lg mb-4">Ainda não tens alunos fixos.</p>
          <Link
            href="/admin/explicacoes/minhas-fixas"
            className="inline-flex items-center gap-2 min-h-11 px-5 py-3 bg-accent hover:bg-accent-hover text-on-accent rounded-2xl font-black text-sm transition-all active:scale-95"
          >
            <ListTree size={16} /> Ir para As Minhas Fixas
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cartoes.map((cartao) => (
            <CartaoAluno key={cartao.alunoId} cartao={cartao} hoje={hoje} />
          ))}
        </div>
      )}

      <StatusToast toast={toast} />
    </main>
  );
}

function CartaoAluno({ cartao, hoje }: { cartao: Cartao; hoje: string }) {
  const diasTeste = cartao.proximoTeste ? diasAteData(cartao.proximoTeste.date, hoje) : null;
  const testeAmbar = diasTeste !== null && diasTeste <= TESTE_AMBAR_LIMITE_DIAS;

  return (
    <Link
      href={`/admin/os-meus-alunos/${cartao.alunoId}`}
      data-cartao-aluno-fixo={cartao.alunoId}
      className="block bg-surface border border-border border-l-4 border-l-success rounded-3xl p-5 space-y-3 hover:bg-raised/40 transition-colors min-h-11"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-black text-primary text-base min-w-0 break-words">{cartao.nome}</p>
        <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-success-bg text-success border border-success/30">
          <Star size={10} /> Fixo
        </span>
      </div>

      <p className="text-xs text-secondary font-bold break-words">
        {cartao.anoEscolar ? `${cartao.anoEscolar}.º ano` : 'Ano não definido'}
        {cartao.disciplinas.length > 0 ? ` · ${cartao.disciplinas.join(', ')}` : ''}
      </p>

      <div className="flex items-start gap-1.5 text-sm">
        <Clock size={14} className="shrink-0 mt-0.5 text-accent" />
        {cartao.proximaSessao ? (
          <p className="text-primary font-bold break-words min-w-0">
            Próxima sessão: {formatarProximaSessaoLabel(cartao.proximaSessao.data, cartao.proximaSessao.hora)}
          </p>
        ) : (
          <p className="text-muted italic">Sem sessão marcada</p>
        )}
      </div>

      {cartao.proximoTeste ? (
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border break-words ${
            testeAmbar ? 'bg-warning-bg text-warning border-warning/30' : 'bg-page text-secondary border-border'
          }`}
        >
          Teste de {cartao.proximoTeste.subjectName} {rotuloDiasTeste(diasTeste!)}
        </span>
      ) : (
        <p className="text-[10px] text-muted font-bold uppercase tracking-widest">Sem testes marcados</p>
      )}

      <p className="text-xs text-muted line-clamp-2 break-words">
        <span className="font-bold text-secondary">Última sessão: </span>
        {cartao.ultimaNota ? cartao.ultimaNota.notas : 'ainda sem notas.'}
      </p>
    </Link>
  );
}
