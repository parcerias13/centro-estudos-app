'use client';

import { useState, useEffect, Suspense } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, UserCheck, ShieldAlert, ToggleLeft, ToggleRight, GraduationCap } from 'lucide-react';

function EditarAlunoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = searchParams.get('id');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');

  // Estados atualizados com a disciplina do teste
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [anoEscolar, setAnoEscolar] = useState('10');
  const [limiteSemanal, setLimiteSemanal] = useState('3');
  const [saidaAutorizada, setSaidaAutorizada] = useState(false);
  const [proximoTeste, setProximoTeste] = useState(''); // ADICIONADO

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    if (studentId) carregarDados();
  }, [studentId]);

  const carregarDados = async () => {
    const { data, error } = await supabase
      .from('alunos')
      .select('*')
      .eq('id', studentId)
      .single();

    if (error) {
      setErro('Não foi possível carregar o aluno.');
    } else if (data) {
      setNome(data.nome || '');
      setTelefone(data.telefone_encarregado || '');
      setAnoEscolar(data.ano_escolar?.toString() || '10');
      setLimiteSemanal(data.limite_semanal?.toString() || '3');
      setSaidaAutorizada(data.saida_autorizada || false);
      setProximoTeste(data.proximo_teste_disciplina || ''); // CARREGADO DO DB
    }
    setLoading(false);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    const { error } = await supabase
      .from('alunos')
      .update({
        nome,
        telefone_encarregado: telefone,
        ano_escolar: parseInt(anoEscolar),
        limite_semanal: parseInt(limiteSemanal),
        saida_autorizada: saidaAutorizada,
        proximo_teste_disciplina: proximoTeste, // AGORA GRAVA O TESTE
      })
      .eq('id', studentId);

    if (error) {
      setErro(`Erro ao atualizar: ${error.message}`);
      setSaving(false);
    } else {
      router.push('/admin/alunos');
      router.refresh();
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/alunos" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
          <ArrowLeft size={20} className="text-slate-400" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <UserCheck className="text-blue-500" /> Editar Aluno
          </h1>
        </div>
      </div>

      <form onSubmit={handleUpdate} className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nome</label>
            <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500" />
          </div>

          {/* NOVO CAMPO ADICIONADO PARA A DEMO */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <GraduationCap size={14} className="text-yellow-500" /> Próximo Teste
            </label>
            <input 
              type="text" 
              value={proximoTeste} 
              onChange={(e) => setProximoTeste(e.target.value)} 
              className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-yellow-500/50"
              placeholder="Ex: Matemática"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Telemóvel Encarregado</label>
            <input type="text" required value={telefone} onChange={(e) => setTelefone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Limite Semanal</label>
            <select value={limiteSemanal} onChange={(e) => setLimiteSemanal(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none">
              {[1,2,3,4,5,99].map(n => <option key={n} value={n}>{n === 99 ? 'Sem Limite' : `${n}x por semana`}</option>)}
            </select>
          </div>
        </div>

        <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 flex items-center justify-between mb-8">
          <div>
            <h4 className="font-bold text-white">Saída Autorizada</h4>
            <p className="text-xs text-slate-500">O aluno pode sair sem acompanhante?</p>
          </div>
          <button type="button" onClick={() => setSaidaAutorizada(!saidaAutorizada)} className={`transition-colors ${saidaAutorizada ? 'text-emerald-500' : 'text-slate-600'}`}>
            {saidaAutorizada ? <ToggleRight size={48} /> : <ToggleLeft size={48} />}
          </button>
        </div>

        <button type="submit" disabled={saving} className="w-full bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-xl font-black flex items-center justify-center gap-2 transition-all">
          {saving ? <Loader2 className="animate-spin" /> : <Save size={20} />}
          {saving ? 'A GUARDAR...' : 'ATUALIZAR DADOS'}
        </button>
      </form>
    </main>
  );
}

export default function EditarAluno() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>}>
      <EditarAlunoContent />
    </Suspense>
  );
}