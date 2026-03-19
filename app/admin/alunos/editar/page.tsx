'use client';

import { useState, useEffect, Suspense } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, UserCheck, ShieldAlert, ToggleLeft, ToggleRight, Calendar, Camera } from 'lucide-react';

function EditarAlunoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = searchParams.get('id');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState('');

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [anoEscolar, setAnoEscolar] = useState('10');
  const [limiteSemanal, setLimiteSemanal] = useState('3');
  const [saidaAutorizada, setSaidaAutorizada] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null); // NOVO: Estado da Foto
  
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);

  const diasSemana = [
    { id: 1, label: 'Segunda' }, { id: 2, label: 'Terça' }, { id: 3, label: 'Quarta' },
    { id: 4, label: 'Quinta' }, { id: 5, label: 'Sexta' }, { id: 6, label: 'Sábado' }
  ];

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    if (studentId) carregarDados();
  }, [studentId]);

  const carregarDados = async () => {
    // 1. Carregar dados do Aluno
    const { data: aluno, error: errAluno } = await supabase
      .from('alunos')
      .select('*')
      .eq('id', studentId)
      .single();

    if (errAluno) {
      setErro('Não foi possível carregar os dados do aluno.');
    } else if (aluno) {
      setNome(aluno.nome || '');
      setTelefone(aluno.telefone_encarregado || '');
      setAnoEscolar(aluno.ano_escolar?.toString() || '10');
      setLimiteSemanal(aluno.limite_semanal?.toString() || '3');
      setSaidaAutorizada(aluno.saida_autorizada || false);
      setAvatarUrl(aluno.avatar_url || null); // CARREGA A FOTO EXISTENTE
    }

    // 2. Carregar Horários atuais
    const { data: horarios } = await supabase
      .from('aluno_horarios')
      .select('dia_semana')
      .eq('aluno_id', studentId);

    if (horarios) {
      setDiasSelecionados(horarios.map(h => h.dia_semana));
    }

    setLoading(false);
  };

  // LÓGICA DE UPLOAD DE FOTO
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);
      setErro('');
      if (!e.target.files || e.target.files.length === 0) return;

      const file = e.target.files[0];
      const fileExt = file.name.split('.').pop();
      // O nome é a junção do ID do aluno e um random para quebrar o cache do browser se ele mudar de foto
      const fileName = `${studentId}-${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatares')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatares').getPublicUrl(filePath);
      setAvatarUrl(data.publicUrl);

    } catch (error: any) {
      setErro('Erro no upload da foto: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const toggleDia = (id: number) => {
    const limite = parseInt(limiteSemanal);
    
    setDiasSelecionados(prev => {
      if (prev.includes(id)) {
        return prev.filter(d => d !== id);
      }
      
      if (limite !== 99 && prev.length >= limite) {
        alert(`O limite atual do aluno é de ${limite} dia(s) por semana.`);
        return prev;
      }
      
      return [...prev, id];
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErro('');

    const limite = parseInt(limiteSemanal);

    if (limite !== 99 && diasSelecionados.length > limite) {
      setErro(`Erro: Tens ${diasSelecionados.length} dias selecionados, mas o limite é ${limite}. Desmarca dias primeiro.`);
      setSaving(false);
      return;
    }

    if (diasSelecionados.length === 0) {
      setErro('Erro: O aluno precisa de ter pelo menos 1 dia de estudo definido.');
      setSaving(false);
      return;
    }

    try {
      // 1. Atualizar perfil do aluno
      const { error: errUpdate } = await supabase
        .from('alunos')
        .update({
          nome,
          telefone_encarregado: telefone,
          ano_escolar: parseInt(anoEscolar),
          limite_semanal: limite,
          saida_autorizada: saidaAutorizada,
          avatar_url: avatarUrl, // GRAVA A NOVA FOTO NA BASE DE DADOS
        })
        .eq('id', studentId);

      if (errUpdate) throw new Error(errUpdate.message);

      // 2. Apagar horários antigos
      const { error: errDelete } = await supabase
        .from('aluno_horarios')
        .delete()
        .eq('aluno_id', studentId);

      if (errDelete) throw new Error(errDelete.message);

      // 3. Inserir horários novos
      const novosHorarios = diasSelecionados.map(dia => ({
        aluno_id: studentId,
        dia_semana: dia
      }));

      const { error: errInsert } = await supabase
        .from('aluno_horarios')
        .insert(novosHorarios);

      if (errInsert) throw new Error(errInsert.message);

      router.push('/admin/alunos');
      router.refresh();

    } catch (err: any) {
      setErro(`Falha na atualização: ${err.message}`);
      setSaving(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 max-w-3xl mx-auto pb-20">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/alunos" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
          <ArrowLeft size={20} className="text-slate-400" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <UserCheck className="text-blue-500" /> Editar Aluno
          </h1>
          <p className="text-slate-500 text-xs mt-1">Atualiza os acessos e informações base.</p>
        </div>
      </div>

      <form onSubmit={handleUpdate} className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl">
        
        {erro && (
          <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-start gap-3 text-red-500 mb-6">
            <ShieldAlert className="shrink-0" size={20} />
            <p className="text-sm font-bold">{erro}</p>
          </div>
        )}

        {/* SECÇÃO DE EDIÇÃO DE FOTO ADICIONADA AQUI */}
        <section className="flex flex-col items-center gap-4 py-4 mb-8 border-b border-slate-800/50">
          <div className="relative group">
            <div className={`w-32 h-32 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl flex items-center justify-center transition-all ${!avatarUrl ? 'bg-slate-950' : ''}`}>
              {avatarUrl ? (
                <img src={avatarUrl} className="w-full h-full object-cover" alt="Preview" />
              ) : (
                <Camera size={40} className="text-slate-800" />
              )}
              {uploading && <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>}
            </div>
            <label className="absolute -bottom-2 -right-2 bg-blue-600 p-3 rounded-2xl cursor-pointer hover:bg-blue-500 transition-all shadow-xl">
              <Camera size={20} />
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={uploading} />
            </label>
          </div>
          <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Foto de Perfil</p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nome Completo</label>
            <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ano Escolar</label>
            <select value={anoEscolar} onChange={(e) => setAnoEscolar(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500 appearance-none">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(ano => (
                <option key={ano} value={ano}>{ano}º Ano</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Telemóvel Encarregado</label>
            <input type="text" required value={telefone} onChange={(e) => setTelefone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Limite Semanal</label>
            <select value={limiteSemanal} onChange={(e) => setLimiteSemanal(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-xl outline-none focus:border-blue-500">
              {[1,2,3,4,5,99].map(n => <option key={n} value={n}>{n === 99 ? 'Ilimitado (99x)' : `${n}x por semana`}</option>)}
            </select>
          </div>
        </div>

        <hr className="border-slate-800 mb-8" />

        <div className="space-y-4 mb-8">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Calendar size={14} /> Dias de Estudo Autorizados
          </label>
          <div className="flex flex-wrap gap-2">
            {diasSemana.map(d => (
              <button
                key={d.id} type="button"
                onClick={() => toggleDia(d.id)}
                className={`flex-1 min-w-20 p-3 rounded-xl border text-xs font-black transition-all ${diasSelecionados.includes(d.id) ? 'bg-blue-600 border-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.3)]' : 'bg-slate-950 border-slate-800 text-slate-500 hover:bg-slate-900'}`}
              >
                {d.label}
              </button>
            ))}
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

        <button type="submit" disabled={saving || uploading} className="w-full bg-blue-600 hover:bg-blue-500 text-white p-5 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50">
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