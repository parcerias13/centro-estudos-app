'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, UserPlus, ShieldAlert, Calendar, CreditCard } from 'lucide-react';

export default function NovoAluno() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [pacotes, setPacotes] = useState<any[]>([]);

  // Campos Básicos
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('123456');
  const [telefone, setTelefone] = useState('');
  const [anoEscolar, setAnoEscolar] = useState('10');

  // Novos Campos: Lógica de Negócio
  const [pacoteId, setPacoteId] = useState('');
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);

  const diasSemana = [
    { id: 1, label: 'Seg' }, { id: 2, label: 'Ter' }, { id: 3, label: 'Qua' },
    { id: 4, label: 'Qui' }, { id: 5, label: 'Sex' }, { id: 6, label: 'Sáb' }
  ];

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Carregar pacotes da DB ao iniciar
  useEffect(() => {
    const fetchPacotes = async () => {
      const { data } = await supabase.from('pacotes').select('*').order('sessoes_semanais');
      if (data) setPacotes(data);
    };
    fetchPacotes();
  }, []);

  const toggleDia = (id: number) => {
    setDiasSelecionados(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pacoteId || diasSelecionados.length === 0) {
      setErro('Deves selecionar um pacote e pelo menos um dia da semana.');
      return;
    }

    setLoading(true);
    setErro('');

    try {
      // 1. Criar Auth (Cliente Fantasma)
      const adminAuthClient = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
      );

      const { data: authData, error: authError } = await adminAuthClient.auth.signUp({ email, password });
      if (authError) throw new Error(`Erro no Acesso: ${authError.message}`);
      const novoId = authData.user!.id;

      // 2. Inserir Aluno com vínculo ao Pacote
      const { error: dbError } = await supabase.from('alunos').insert({
        id: novoId,
        nome,
        email,
        telefone_encarregado: telefone,
        ano_escolar: parseInt(anoEscolar),
        pacote_id: pacoteId, // Chave Estrangeira para o pacote
        saida_autorizada: false,
      });
      if (dbError) throw new Error(`Erro na DB: ${dbError.message}`);

      // 3. Inserir Horários (Bulk Insert)
      const horarios = diasSelecionados.map(dia => ({
        aluno_id: novoId,
        dia_semana: dia
      }));
      const { error: hError } = await supabase.from('aluno_horarios').insert(horarios);
      if (hError) throw new Error(`Erro nos Horários: ${hError.message}`);

      router.push('/admin/alunos');
      router.refresh();

    } catch (err: any) {
      setErro(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 max-w-3xl mx-auto">
      {/* Header omitido para brevidade (mantém o teu igual) */}

      <form onSubmit={handleGuardar} className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl space-y-8">
        {erro && <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl text-red-500 text-sm font-bold flex gap-2"><ShieldAlert /> {erro}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Dados Pessoais (Nome, Email, Password, Telemóvel - Iguais ao teu original) */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nome do Aluno</label>
            <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500" />
          </div>
          {/* ... outros campos ... */}
        </div>

        <hr className="border-slate-800" />

        {/* LÓGICA DE NEGÓCIO: PACOTES */}
        <div className="space-y-4">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <CreditCard size={14} /> Seleção de Pacote *
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {pacotes.map(p => (
              <button 
                key={p.id} type="button"
                onClick={() => setPacoteId(p.id)}
                className={`p-4 rounded-xl border text-left transition-all ${pacoteId === p.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}
              >
                <p className="font-bold text-sm">{p.nome}</p>
                <p className="text-[10px] text-slate-500 uppercase font-black">{p.sessoes_semanais}x / Semana</p>
              </button>
            ))}
          </div>
        </div>

        {/* LÓGICA DE NEGÓCIO: DIAS DA SEMANA */}
        <div className="space-y-4">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Calendar size={14} /> Dias Autorizados *
          </label>
          <div className="flex flex-wrap gap-2">
            {diasSemana.map(d => (
              <button
                key={d.id} type="button"
                onClick={() => toggleDia(d.id)}
                className={`flex-1 min-w-15 p-3 rounded-xl border text-xs font-black transition-all ${diasSelecionados.includes(d.id) ? 'bg-blue-600 border-blue-500' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white p-5 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50">
          {loading ? <Loader2 className="animate-spin" /> : <Save size={20} />}
          {loading ? 'A PROCESSAR...' : 'FINALIZAR MATRÍCULA'}
        </button>
      </form>
    </main>
  );
}