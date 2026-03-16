'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, UserPlus, ShieldAlert, Calendar, CreditCard, Mail, Phone, GraduationCap } from 'lucide-react';

export default function NovoAluno() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [pacotes, setPacotes] = useState<any[]>([]);

  // 1. DADOS PESSOAIS (Recuperados)
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('123456'); // Password padrão
  const [telefone, setTelefone] = useState('');
  const [anoEscolar, setAnoEscolar] = useState('10');

  // 2. LÓGICA DE NEGÓCIO (Pacotes e Dias)
  const [pacoteId, setPacoteId] = useState('');
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);

  const diasSemana = [
    { id: 1, label: 'Segunda' }, { id: 2, label: 'Terça' }, { id: 3, label: 'Quarta' },
    { id: 4, label: 'Quinta' }, { id: 5, label: 'Sexta' }, { id: 6, label: 'Sábado' }
  ];

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Carregar pacotes para o Select
  useEffect(() => {
    const fetchPacotes = async () => {
      const { data } = await supabase.from('pacotes').select('*').order('sessoes_semanais');
      if (data) setPacotes(data);
    };
    fetchPacotes();
  }, []);

  const toggleDia = (id: number) => {
    setDiasSelecionados(prev => 
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pacoteId || diasSelecionados.length === 0) {
      setErro('Define o pacote e os dias autorizados. Sem regras, não há controlo.');
      return;
    }

    setLoading(true);
    setErro('');

    try {
      // A. AUTH (Ghost Client - Não desloga o Admin)
      const adminAuthClient = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
      );

      const { data: authData, error: authError } = await adminAuthClient.auth.signUp({ email, password });
      if (authError) throw new Error(`Erro Auth: ${authError.message}`);
      const novoId = authData.user!.id;

      // B. BASE DE DADOS (Inserir Perfil Completo)
      const { error: dbError } = await supabase.from('alunos').insert({
        id: novoId,
        nome,
        email,
        telefone_encarregado: telefone,
        ano_escolar: parseInt(anoEscolar),
        pacote_id: pacoteId,
        saida_autorizada: false, // Segurança máxima por defeito
      });
      if (dbError) throw new Error(`Erro DB: ${dbError.message}`);

      // C. HORÁRIOS (Inserção em Bloco)
      const horarios = diasSelecionados.map(dia => ({
        aluno_id: novoId,
        dia_semana: dia
      }));
      const { error: hError } = await supabase.from('aluno_horarios').insert(horarios);
      if (hError) throw new Error(`Erro Horários: ${hError.message}`);

      router.push('/admin/alunos');
      router.refresh();

    } catch (err: any) {
      setErro(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 max-w-4xl mx-auto">
      
      {/* HEADER */}
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/alunos" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
          <ArrowLeft size={20} className="text-slate-400" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <UserPlus className="text-blue-500" /> Nova Matrícula
          </h1>
          <p className="text-slate-500 text-xs">Registo completo: Perfil, Acessos e Contrato.</p>
        </div>
      </div>

      <form onSubmit={handleGuardar} className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-10">
        
        {erro && (
          <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-start gap-3 text-red-500">
            <ShieldAlert className="shrink-0" size={20} />
            <p className="text-sm font-bold">{erro}</p>
          </div>
        )}

        {/* SECÇÃO 1: DADOS DO ALUNO */}
        <div className="space-y-6">
          <h2 className="text-xs font-black uppercase text-blue-500 tracking-widest">1. Identificação do Aluno</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nome Completo *</label>
              <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500" placeholder="Ex: Tomás Silva" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ano Escolar *</label>
              <select value={anoEscolar} onChange={(e) => setAnoEscolar(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 appearance-none">
                {[5,6,7,8,9,10,11,12].map(ano => <option key={ano} value={ano}>{ano}º Ano</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Email (Login) *</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500" placeholder="aluno@centro.pt" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Telemóvel Encarregado *</label>
              <input type="text" required value={telefone} onChange={(e) => setTelefone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500" placeholder="Ex: 351912345678" />
            </div>
          </div>
        </div>

        <hr className="border-slate-800" />

        {/* SECÇÃO 2: CONTRATO E PACOTES */}
        <div className="space-y-6">
          <h2 className="text-xs font-black uppercase text-blue-500 tracking-widest">2. Plano e Frequência</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {pacotes.map(p => (
              <button 
                key={p.id} type="button"
                onClick={() => setPacoteId(p.id)}
                className={`p-4 rounded-2xl border text-left transition-all ${pacoteId === p.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}
              >
                <p className="font-bold text-sm text-white">{p.nome}</p>
                <p className="text-[10px] text-slate-500 uppercase font-black">{p.sessoes_semanais}x / Semana</p>
              </button>
            ))}
          </div>
        </div>

        {/* SECÇÃO 3: DIAS DA SEMANA */}
        <div className="space-y-4">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Calendar size={14} /> Dias de Estudo Autorizados *
          </label>
          <div className="flex flex-wrap gap-2">
            {diasSemana.map(d => (
              <button
                key={d.id} type="button"
                onClick={() => toggleDia(d.id)}
                className={`flex-1 min-w-20 p-3 rounded-xl border text-xs font-black transition-all ${diasSelecionados.includes(d.id) ? 'bg-blue-600 border-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.3)]' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* SUBMIT */}
        <button 
          type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white p-5 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
        >
          {loading ? <Loader2 className="animate-spin" /> : <Save size={20} />}
          {loading ? 'A REGISTAR MATRÍCULA...' : 'FINALIZAR E CRIAR ACESSOS'}
        </button>

      </form>
    </main>
  );
}