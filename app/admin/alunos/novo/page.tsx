'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, UserPlus, ShieldAlert } from 'lucide-react';

export default function NovoAluno() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  // Campos do Formulário
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('123456'); // Password padrão para novos alunos
  const [telefone, setTelefone] = useState('');
  const [anoEscolar, setAnoEscolar] = useState('10');
  const [limiteSemanal, setLimiteSemanal] = useState('3');

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErro('');

    try {
      // 1. O TRUQUE DE MESTRE: O "Cliente Fantasma"
      // Criamos uma instância que NÃO faz login automático para proteger a tua sessão de Admin
      const adminAuthClient = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
      );

      // 2. Criar a "Identidade" no Auth
      const { data: authData, error: authError } = await adminAuthClient.auth.signUp({
        email,
        password,
      });

      if (authError) throw new Error(`Erro no Acesso: ${authError.message}`);
      if (!authData.user) throw new Error('Falha fatal: ID não gerado.');

      const novoId = authData.user.id; // Temos a chave!

      // 3. O cliente normal para gravar na base de dados
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      // 4. Injetar o registo unificado na tabela 'alunos' (O "Aperto de Mão" automático)
      const { error: dbError } = await supabase.from('alunos').insert({
        id: novoId, 
        nome,
        email,
        telefone_encarregado: telefone,
        ano_escolar: parseInt(anoEscolar),
        limite_semanal: parseInt(limiteSemanal),
        saida_autorizada: false, // Política rígida: bloqueado por defeito
      });

      if (dbError) throw new Error(`Erro na Base de Dados: ${dbError.message}`);

      // 5. Missão Cumprida. Regressa à Base.
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
      
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/alunos" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
          <ArrowLeft size={20} className="text-slate-400" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <UserPlus className="text-blue-500" />
            Nova Matrícula
          </h1>
          <p className="text-slate-500 text-xs">Criação automatizada de Perfil e Acesso.</p>
        </div>
      </div>

      <form onSubmit={handleGuardar} className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl">
        
        {erro && (
          <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-start gap-3 mb-8 text-red-500">
            <ShieldAlert className="shrink-0" size={20} />
            <p className="text-sm font-bold">{erro}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* NOME */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nome do Aluno *</label>
            <input 
              type="text" required
              value={nome} onChange={(e) => setNome(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500 transition-colors"
              placeholder="Ex: Tomás Silva"
            />
          </div>

          {/* ANO ESCOLAR */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ano Escolar *</label>
            <select 
              value={anoEscolar} onChange={(e) => setAnoEscolar(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500 transition-colors appearance-none"
            >
              {[5,6,7,8,9,10,11,12].map(ano => (
                <option key={ano} value={ano}>{ano}º Ano</option>
              ))}
            </select>
          </div>

          {/* EMAIL */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Email (Login) *</label>
            <input 
              type="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500 transition-colors"
              placeholder="aluno@centro.pt"
            />
          </div>

          {/* PASSWORD */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Password Provisória *</label>
            <input 
              type="text" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* CONTACTO EE */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Telemóvel Encarregado *</label>
            <input 
              type="text" required
              value={telefone} onChange={(e) => setTelefone(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500 transition-colors"
              placeholder="Ex: 351912345678"
            />
          </div>

          {/* PACOTE MENSAL/SEMANAL */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pacote (Sessões/Semana) *</label>
            <select 
              value={limiteSemanal} onChange={(e) => setLimiteSemanal(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500 transition-colors appearance-none"
            >
              <option value="1">1x por semana</option>
              <option value="2">2x por semana</option>
              <option value="3">3x por semana</option>
              <option value="4">4x por semana</option>
              <option value="5">5x por semana</option>
              <option value="99">Livre (Sem Limite)</option>
            </select>
          </div>
        </div>

        <button 
          type="submit" 
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-xl font-black flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="animate-spin" /> : <Save size={20} />}
          {loading ? 'A PROCESSAR MATRÍCULA...' : 'CRIAR ALUNO E ACESSOS'}
        </button>

      </form>
    </main>
  );
}