'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { ArrowLeft, User, Mail, Shield, Lock, KeyRound, Eye, EyeOff, Loader2, Save, ChevronRight } from 'lucide-react';
import { getHojeLisboa } from '@/lib/dataLisboa';
import { somarMeses, mesParaData } from '@/lib/custos';
import { janelaMesLisboa, somaMinutosFechados, formatarDuracao } from '@/lib/registosHoras';
import { buscarAlunosFixosAtivos } from '@/lib/osMeusAlunos';

// Iniciais para a bolinha do cabeçalho: 1.ª letra da 1.ª e da última palavra
// do nome (só a 1.ª se houver uma palavra só; "?" se vazio).
function iniciais(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return '?';
  if (palavras.length === 1) return palavras[0][0].toUpperCase();
  return (palavras[0][0] + palavras[palavras.length - 1][0]).toUpperCase();
}

// "42 h 15 min", exceto exatamente 0 -> "0 h" — os minutos nunca são
// recalculados aqui, só formatados (ver formatarDuracao em lib/registosHoras).
function formatarHorasMes(minutos: number): string {
  return minutos === 0 ? '0 h' : formatarDuracao(minutos);
}

// Dica em direto por baixo do formulário de palavra-passe, por prioridade:
// comprimento mínimo primeiro, depois coincidência, depois igual à atual.
function calcularDicaPassword(atual: string, nova: string, repetirNova: string): string | null {
  if (nova.length > 0 && nova.length < 6) return `Faltam ${6 - nova.length} caracteres.`;
  if (repetirNova.length > 0 && nova !== repetirNova) return 'As palavras-passe não coincidem.';
  if (nova.length > 0 && atual.length > 0 && nova === atual) return 'A nova palavra-passe tem de ser diferente da atual.';
  return null;
}

const ATALHOS_PROFESSOR = [
  { titulo: 'Horas de trabalho', descricao: 'Registo e total do mês', href: '/admin/horas' },
  { titulo: 'Os meus alunos', descricao: 'Fixos, notas e material', href: '/admin/os-meus-alunos' },
  { titulo: 'As minhas fixas', descricao: 'Explicações semanais', href: '/admin/explicacoes/minhas-fixas' },
];

function CartaoNumero({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-3 text-center shadow-sm min-w-0">
      <p className="text-[9px] font-black uppercase tracking-widest text-muted mb-1.5 leading-tight">{label}</p>
      {loading ? (
        <Loader2 className="animate-spin text-accent mx-auto" size={16} />
      ) : (
        <p className="font-black text-primary text-sm leading-tight">{value}</p>
      )}
    </div>
  );
}

export default function PerfilStaffPage() {
  const router = useRouter();
  const { toast, showError, showSuccess } = useStatusToast();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [cargo, setCargo] = useState('');

  const [mostrarSeguranca, setMostrarSeguranca] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetirNova, setRepetirNova] = useState('');
  const [mostrarAtual, setMostrarAtual] = useState(false);
  const [mostrarNova, setMostrarNova] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [statsLoading, setStatsLoading] = useState(true);
  const [horasMinutos, setHorasMinutos] = useState<number | null>(null);
  const [sessoesDadas, setSessoesDadas] = useState<number | null>(null);
  const [alunosFixosCount, setAlunosFixosCount] = useState<number | null>(null);

  const isProfessor = cargo.toLowerCase() === 'professor';

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      setUserId(user.id);

      const { data: staff, error } = await supabase
        .from('staff')
        .select('name, email, role')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        showError('Não foi possível carregar o perfil: ' + error.message);
      } else if (staff) {
        setNome(staff.name || '');
        setEmail(staff.email || user.email || '');
        setCargo(staff.role || '');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isProfessor || !userId) return;
    let cancelado = false;

    (async () => {
      setStatsLoading(true);
      const hojeISO = getHojeLisboa();
      const mesAtual = hojeISO.slice(0, 7);
      const inicioMes = mesParaData(mesAtual);
      const inicioProximoMes = mesParaData(somarMeses(mesAtual, 1));

      const [horasResultado, sessoesResultado, fixosResultado] = await Promise.allSettled([
        (async () => {
          const { inicio, fim } = janelaMesLisboa(mesAtual);
          const { data, error } = await supabase
            .from('registos_horas_professor')
            .select('minutos')
            .eq('professor_id', userId)
            .gte('entrada', inicio)
            .lt('entrada', fim);
          if (error) throw error;
          return somaMinutosFechados((data || []).map((r: any) => ({ minutos: r.minutos == null ? null : Number(r.minutos) })));
        })(),
        (async () => {
          const { count, error } = await supabase
            .from('explicacoes')
            .select('id', { count: 'exact', head: true })
            .eq('professor_id', userId)
            .eq('dado', true)
            .gte('data', inicioMes)
            .lt('data', inicioProximoMes);
          if (error) throw error;
          return count ?? 0;
        })(),
        (async () => {
          const fixos = await buscarAlunosFixosAtivos(supabase, userId, hojeISO);
          return fixos.length;
        })(),
      ]);

      if (cancelado) return;

      if (horasResultado.status === 'fulfilled') {
        setHorasMinutos(horasResultado.value);
      } else {
        setHorasMinutos(null);
        showError('Não foi possível carregar as horas deste mês: ' + (horasResultado.reason?.message || 'erro desconhecido'));
      }

      if (sessoesResultado.status === 'fulfilled') {
        setSessoesDadas(sessoesResultado.value);
      } else {
        setSessoesDadas(null);
        showError('Não foi possível carregar as sessões dadas: ' + (sessoesResultado.reason?.message || 'erro desconhecido'));
      }

      if (fixosResultado.status === 'fulfilled') {
        setAlunosFixosCount(fixosResultado.value);
      } else {
        setAlunosFixosCount(null);
        showError('Não foi possível carregar os alunos fixos: ' + (fixosResultado.reason?.message || 'erro desconhecido'));
      }

      setStatsLoading(false);
    })();

    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProfessor, userId]);

  const mensagemSucesso = isProfessor
    ? 'Palavra-passe alterada. A tua sessão continua aberta.'
    : 'Palavra-passe alterada com sucesso.';

  const dicaPassword = calcularDicaPassword(atual, nova, repetirNova);
  const podeGuardarPassword = !!atual && !!nova && !!repetirNova && nova.length >= 6 && nova === repetirNova && nova !== atual;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    if (!atual || !nova) {
      setErro('Preenche a palavra-passe atual e a nova.');
      return;
    }
    if (nova.length < 6) {
      setErro('A nova palavra-passe tem de ter pelo menos 6 caracteres.');
      return;
    }
    if (nova !== repetirNova) {
      setErro('As duas palavras-passe novas não coincidem.');
      return;
    }
    if (nova === atual) {
      setErro('A nova palavra-passe tem de ser diferente da atual.');
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch('/api/conta/alterar-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atual, nova }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(body?.error || `Erro (${res.status}). Tenta novamente.`);
        return;
      }
      showSuccess(mensagemSucesso);
      setAtual('');
      setNova('');
      setRepetirNova('');
      if (isProfessor) setMostrarSeguranca(false);
    } catch (err: any) {
      setErro(err?.message || 'Erro de rede. Tenta novamente.');
    } finally {
      setEnviando(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" size={32} /></div>;
  }

  const destinoVoltar = cargo.toLowerCase() === 'admin' ? '/admin/equipa' : '/admin';

  if (isProfessor) {
    return (
      <main className="min-h-screen bg-page text-primary p-6 max-w-xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href={destinoVoltar} className="bg-surface p-3 rounded-xl hover:bg-raised transition-colors border border-border">
            <ArrowLeft size={20} className="text-secondary" />
          </Link>
          <div>
            <h1 className="text-2xl font-black">O Meu Perfil</h1>
            <p className="text-muted text-xs font-bold uppercase tracking-widest mt-1">Dados da Conta</p>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full bg-accent text-on-accent flex items-center justify-center font-black text-lg shrink-0">
            {iniciais(nome)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-black text-xl text-primary truncate">{nome || '—'}</p>
            <p className="text-sm text-secondary truncate">{email || '—'}</p>
            <span className="inline-block mt-1.5 text-[10px] font-black uppercase tracking-widest bg-success-bg text-success border border-success/30 rounded-full px-2.5 py-1">
              Professor
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-6">
          <CartaoNumero
            label="Horas este mês"
            value={horasMinutos === null ? '—' : formatarHorasMes(horasMinutos)}
            loading={statsLoading}
          />
          <CartaoNumero
            label="Sessões dadas"
            value={sessoesDadas === null ? '—' : String(sessoesDadas)}
            loading={statsLoading}
          />
          <CartaoNumero
            label="Alunos fixos"
            value={alunosFixosCount === null ? '—' : String(alunosFixosCount)}
            loading={statsLoading}
          />
        </div>

        <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden mb-6 shadow-sm">
          {ATALHOS_PROFESSOR.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="flex items-center justify-between gap-3 p-4 min-h-[52px] hover:bg-raised transition-colors"
            >
              <div className="min-w-0">
                <p className="font-bold text-primary text-sm">{a.titulo}</p>
                <p className="text-xs text-secondary mt-0.5">{a.descricao}</p>
              </div>
              <ChevronRight size={18} className="text-muted shrink-0" />
            </Link>
          ))}
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-black text-primary">Segurança</h3>
              <p className="text-sm text-secondary">Palavra-passe da tua conta</p>
            </div>
            <button
              type="button"
              onClick={() => { setMostrarSeguranca((v) => !v); setErro(null); }}
              className="shrink-0 text-sm font-bold text-accent hover:text-accent-hover px-3 py-2 rounded-xl border border-border hover:bg-raised transition-colors"
            >
              {mostrarSeguranca ? 'Fechar' : 'Alterar'}
            </button>
          </div>

          {mostrarSeguranca && (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-secondary">Palavra-passe atual</label>
                <div className="relative mt-1">
                  <input
                    type={mostrarAtual ? 'text' : 'password'}
                    value={atual}
                    onChange={(e) => setAtual(e.target.value)}
                    autoComplete="current-password"
                    placeholder="A tua palavra-passe atual"
                    className="w-full bg-page border border-border text-primary pl-4 pr-12 py-3 rounded-2xl outline-none focus:border-accent transition-all font-medium placeholder:text-muted"
                  />
                  <button
                    type="button"
                    aria-label={mostrarAtual ? 'Ocultar palavra-passe atual' : 'Mostrar palavra-passe atual'}
                    onClick={() => setMostrarAtual((v) => !v)}
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-muted hover:text-primary transition-colors"
                  >
                    {mostrarAtual ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-secondary">Nova palavra-passe</label>
                <div className="relative mt-1">
                  <input
                    type={mostrarNova ? 'text' : 'password'}
                    value={nova}
                    onChange={(e) => setNova(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-page border border-border text-primary pl-4 pr-12 py-3 rounded-2xl outline-none focus:border-accent transition-all font-medium placeholder:text-muted"
                  />
                  <button
                    type="button"
                    aria-label={mostrarNova ? 'Ocultar nova palavra-passe' : 'Mostrar nova palavra-passe'}
                    onClick={() => setMostrarNova((v) => !v)}
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-muted hover:text-primary transition-colors"
                  >
                    {mostrarNova ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-secondary">Repetir a nova</label>
                <input
                  type="password"
                  value={repetirNova}
                  onChange={(e) => setRepetirNova(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Repetir a nova palavra-passe"
                  className="w-full bg-page border border-border text-primary px-4 py-3 rounded-2xl outline-none focus:border-accent transition-all font-medium placeholder:text-muted mt-1"
                />
              </div>

              {dicaPassword && (
                <p className="text-xs font-bold text-warning">{dicaPassword}</p>
              )}

              {erro && (
                <div className="p-4 rounded-2xl text-sm font-bold text-center border bg-danger-bg text-danger border-danger/20">
                  {erro}
                </div>
              )}

              <button
                type="submit"
                disabled={!podeGuardarPassword || enviando}
                className={`w-full py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 ${
                  podeGuardarPassword && !enviando
                    ? 'bg-accent hover:bg-accent-hover text-on-accent active:scale-95'
                    : 'bg-page border border-border text-muted cursor-not-allowed'
                }`}
              >
                {enviando ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                {enviando ? 'A guardar...' : 'Guardar palavra-passe'}
              </button>
            </form>
          )}
        </div>

        <StatusToast toast={toast} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href={destinoVoltar} className="bg-surface p-3 rounded-xl hover:bg-raised transition-colors border border-border">
          <ArrowLeft size={20} className="text-secondary" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Shield className="text-accent" /> O Meu Perfil
          </h1>
          <p className="text-muted text-xs font-bold uppercase tracking-widest mt-1">Dados da Conta</p>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-3xl p-8 shadow-xl space-y-6 mb-8">
        <div className="flex items-center gap-3">
          <div className="bg-accent-soft text-accent p-2.5 rounded-xl"><User size={18} /></div>
          <div>
            <p className="text-[10px] font-black uppercase text-muted tracking-widest">Nome</p>
            <p className="font-bold text-primary">{nome || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-accent-soft text-accent p-2.5 rounded-xl"><Mail size={18} /></div>
          <div>
            <p className="text-[10px] font-black uppercase text-muted tracking-widest">Email</p>
            <p className="font-bold text-primary">{email || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-accent-soft text-accent p-2.5 rounded-xl"><Shield size={18} /></div>
          <div>
            <p className="text-[10px] font-black uppercase text-muted tracking-widest">Cargo</p>
            <p className="font-bold text-primary uppercase">{cargo || '—'}</p>
          </div>
        </div>
      </div>

      <div className="bg-surface border border-border p-8 rounded-[2.5rem] shadow-xl">
        <h3 className="font-black text-sm uppercase tracking-widest mb-6 flex items-center gap-2 text-secondary">
          <Lock size={18} className="text-yellow-500" /> Alterar Palavra-Passe
        </h3>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-[10px] font-black text-muted uppercase tracking-widest ml-1">Palavra-Passe Atual</label>
            <div className="relative mt-1">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
              <input
                type={mostrarAtual ? 'text' : 'password'}
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
                placeholder="A tua palavra-passe atual"
                className="w-full bg-page border border-border text-primary pl-12 pr-12 py-4 rounded-2xl outline-none focus:border-yellow-500 transition-all font-medium placeholder:text-muted"
              />
              <button
                type="button"
                onClick={() => setMostrarAtual((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
              >
                {mostrarAtual ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-muted uppercase tracking-widest ml-1">Nova Palavra-Passe</label>
            <div className="relative mt-1">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
              <input
                type={mostrarNova ? 'text' : 'password'}
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full bg-page border border-border text-primary pl-12 pr-12 py-4 rounded-2xl outline-none focus:border-yellow-500 transition-all font-medium placeholder:text-muted"
              />
              <button
                type="button"
                onClick={() => setMostrarNova((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
              >
                {mostrarNova ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-muted uppercase tracking-widest ml-1">Repetir Nova Palavra-Passe</label>
            <div className="relative mt-1">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
              <input
                type={mostrarNova ? 'text' : 'password'}
                value={repetirNova}
                onChange={(e) => setRepetirNova(e.target.value)}
                placeholder="Repetir a nova palavra-passe"
                className="w-full bg-page border border-border text-primary pl-12 pr-4 py-4 rounded-2xl outline-none focus:border-yellow-500 transition-all font-medium placeholder:text-muted"
              />
            </div>
          </div>

          {erro && (
            <div className="p-4 rounded-2xl text-xs font-black uppercase tracking-widest text-center border bg-danger-bg text-danger border-danger/20">
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={enviando || !atual || !nova || !repetirNova}
            className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-yellow-950 font-black py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-yellow-900/20 flex items-center justify-center gap-2 mt-2"
          >
            {enviando ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
            {enviando ? 'A ATUALIZAR...' : 'GRAVAR NOVA PALAVRA-PASSE'}
          </button>
        </form>
      </div>

      <StatusToast toast={toast} />
    </main>
  );
}
