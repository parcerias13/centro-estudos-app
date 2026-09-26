'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Shield, Plus, Trash2, Loader2, Save, Mail, User, Lock, X, AlertTriangle } from 'lucide-react';
import { useStatusToast, StatusToast } from '@/lib/statusToast';

export default function AdminTeam() {
  const { toast, showError, showSuccess } = useStatusToast();
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Formulário
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('professor');
  const [password, setPassword] = useState(''); // ESTADO MOVIDO PARA DENTRO

  // Tarifa do professor (modal)
  const [tarifaModalMember, setTarifaModalMember] = useState<any | null>(null);
  const [tarifaTipo, setTarifaTipo] = useState('');
  const [tarifaValor, setTarifaValor] = useState('');
  const [tarifaEscalaAluno, setTarifaEscalaAluno] = useState(false);
  const [savingTarifa, setSavingTarifa] = useState(false);

  // Sessões já dadas por professores sem tarifa definida — aviso, não bloqueio
  // (ver /admin/explicacoes: dado=true sem tarifa grava valor_calculado=0€ em silêncio).
  const [sessoesSemTarifaCount, setSessoesSemTarifaCount] = useState<Record<string, number>>({});

  const fetchTeam = async () => {
    const { data } = await supabase.from('staff').select('*').order('name');
    if (data) setTeam(data);
    setLoading(false);

    const semTarifaIds = (data || [])
      .filter((m) => m.role?.toLowerCase() === 'professor' && !m.tarifa_tipo)
      .map((m) => m.id);

    if (semTarifaIds.length === 0) {
      setSessoesSemTarifaCount({});
      return;
    }

    const { data: sessoesDadas } = await supabase
      .from('explicacoes')
      .select('professor_id')
      .eq('dado', true)
      .in('professor_id', semTarifaIds);

    const contagem: Record<string, number> = {};
    (sessoesDadas || []).forEach((s) => {
      contagem[s.professor_id] = (contagem[s.professor_id] || 0) + 1;
    });
    setSessoesSemTarifaCount(contagem);
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const getAdminContext = async (): Promise<{ centro_id: string } | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    const role_meta = user?.app_metadata?.role;
    const centro_id = user?.app_metadata?.centro_id;

    if (role_meta?.toLowerCase() !== 'admin') {
      setFormError('Sem permissões de administrador para esta ação.');
      return null;
    }
    if (!centro_id) {
      setFormError('Não foi possível obter o centro. Recarrega a página.');
      return null;
    }
    return { centro_id };
  };

  const handleAdd = async (e: any) => {
    e.preventDefault();
    if (!email || !name || !password) return;
    setFormError(null);
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;

    const res = await fetch('/api/admin/criar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        password,
        name,
        role,
        centro_id,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      setFormError(result.error || 'Erro ao criar membro da equipa.');
    } else {
      setName('');
      setEmail('');
      setPassword('');
      fetchTeam();
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este membro da equipa? Ele deixará de ter acesso ao Admin.')) return;
    setFormError(null);

    const ctx = await getAdminContext();
    if (!ctx) return;

    await supabase.from('staff').delete().eq('id', id);
    fetchTeam();
  };

  const abrirTarifaModal = (member: any) => {
    setTarifaModalMember(member);
    setTarifaTipo(member.tarifa_tipo || '');
    setTarifaValor(member.tarifa_valor?.toString() || '');
    setTarifaEscalaAluno(member.tarifa_escala_aluno || false);
  };

  const handleSaveTarifa = async () => {
    if (!tarifaModalMember) return;
    if (!tarifaTipo) {
      showError('Escolhe o tipo de tarifa.');
      return;
    }
    const valor = parseFloat(tarifaValor);
    if (isNaN(valor)) {
      showError('Indica um valor de tarifa válido.');
      return;
    }

    const ctx = await getAdminContext();
    if (!ctx) return;

    setSavingTarifa(true);
    const { error } = await supabase
      .from('staff')
      .update({ tarifa_tipo: tarifaTipo, tarifa_valor: valor, tarifa_escala_aluno: tarifaEscalaAluno })
      .eq('id', tarifaModalMember.id);
    setSavingTarifa(false);

    if (error) {
      showError('Erro ao guardar tarifa: ' + error.message);
      return;
    }
    showSuccess('Tarifa atualizada com sucesso.');
    setTarifaModalMember(null);
    fetchTeam();
  };

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;

  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-5xl mx-auto">
      
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="bg-surface p-3 rounded-xl hover:bg-raised transition-colors border border-border">
          <ArrowLeft size={20} className="text-secondary" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Shield className="text-indigo-500" />
            Gestão de Equipa
          </h1>
          <p className="text-muted text-xs">Quem tem a chave do centro?</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        
        <div className="md:col-span-1 bg-surface border border-border p-6 rounded-2xl h-fit">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-primary">
            <Plus size={20} className="text-green-500" /> Novo Membro
          </h2>
          
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Nome</label>
              <div className="relative">
                <User className="absolute left-3 top-3.5 text-muted" size={16} />
                <input 
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Maria Santos"
                    className="w-full bg-page border border-border text-primary pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Email de Acesso</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 text-muted" size={16} />
                <input 
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@gmail.com"
                    className="w-full bg-page border border-border text-primary pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            {/* CAMPO DA PASSWORD ADICIONADO NO LOCAL CORRETO */}
            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Password Provisória</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 text-muted" size={16} />
                <input 
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-page border border-border text-primary pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Cargo</label>
              <select 
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-indigo-500"
              >
                <option value="professor">Explicador</option>
                <option value="Secretaria">Secretaria</option>
                <option value="Admin">Admin</option>
              </select>
            </div>

            {formError && (
              <p className="text-danger text-[11px] font-bold px-1">{formError}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-primary font-bold py-3 rounded-xl transition-all active:scale-95 shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-2 mt-4"
            >
              {submitting ? <Loader2 className="animate-spin" /> : <><Save size={18} /> Dar Acesso</>}
            </button>
          </form>
        </div>

        <div className="md:col-span-2 space-y-3">
          <h3 className="text-muted font-bold uppercase text-xs tracking-wider mb-2">Equipa Ativa ({team.length})</h3>
          
          {team.map((member) => {
            const isProfessor = member.role?.toLowerCase() === 'professor';
            return (
              <div key={member.id} className="bg-surface border border-border p-4 rounded-xl flex justify-between items-center group hover:border-border transition-all">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-primary ${
                      member.role === 'Admin' || member.role === 'CEO' ? 'bg-indigo-600' : 'bg-border'
                  }`}>
                    {member.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-bold text-primary">{member.name}</h4>
                    <div className="flex items-center gap-2 text-xs text-secondary">
                        <span>{member.email}</span>
                        <span className="w-1 h-1 rounded-full bg-border"></span>
                        <span className="text-indigo-400 font-bold uppercase">{member.role}</span>
                    </div>
                    {isProfessor && member.tarifa_tipo && (
                      <p className="text-[10px] text-accent font-bold mt-1">
                        {member.tarifa_tipo === 'fixo'
                          ? `${Number(member.tarifa_valor).toFixed(2)}€ fixo por sessão`
                          : `${Number(member.tarifa_valor).toFixed(2)}€/hora`}
                        {member.tarifa_escala_aluno ? ' · escala por aluno' : ''}
                      </p>
                    )}
                    {isProfessor && !member.tarifa_tipo && sessoesSemTarifaCount[member.id] > 0 && (
                      <p className="text-[10px] text-warning font-bold mt-1 flex items-center gap-1">
                        <AlertTriangle size={11} />
                        Tarifa não definida — {sessoesSemTarifaCount[member.id]} {sessoesSemTarifaCount[member.id] === 1 ? 'sessão dada' : 'sessões dadas'} sem valor
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {isProfessor && (
                    <button
                      onClick={() => abrirTarifaModal(member)}
                      className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-accent hover:bg-accent-soft rounded-lg transition-colors"
                    >
                      Definir Tarifa
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(member.id)}
                    className="p-2 text-muted hover:text-danger hover:bg-danger-bg rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {tarifaModalMember && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setTarifaModalMember(null); }}
        >
          <div className="bg-surface border border-border w-full max-w-md rounded-3xl shadow-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-primary">Tarifa de {tarifaModalMember.name}</h2>
              <button onClick={() => setTarifaModalMember(null)} className="text-muted hover:text-primary transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-muted uppercase ml-1">Tipo de Tarifa</label>
                <select
                  value={tarifaTipo}
                  onChange={(e) => setTarifaTipo(e.target.value)}
                  className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
                >
                  <option value="">Selecionar...</option>
                  <option value="fixo">Fixo por sessão</option>
                  <option value="por_hora">Por hora</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-muted uppercase ml-1">Valor (€)</label>
                <input
                  type="number"
                  step="0.01"
                  value={tarifaValor}
                  onChange={(e) => setTarifaValor(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
                />
              </div>

              <label className="flex items-center gap-3 bg-page p-4 rounded-xl border border-border cursor-pointer">
                <input
                  type="checkbox"
                  checked={tarifaEscalaAluno}
                  onChange={(e) => setTarifaEscalaAluno(e.target.checked)}
                  className="w-4 h-4 accent-accent"
                />
                <span className="text-sm font-bold text-primary">Multiplica pelo nº de alunos presentes na sessão</span>
              </label>
            </div>

            <button
              onClick={handleSaveTarifa}
              disabled={savingTarifa}
              className="w-full mt-6 bg-accent hover:bg-accent-hover text-on-accent p-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {savingTarifa ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
              Guardar Tarifa
            </button>
          </div>
        </div>
      )}

      <StatusToast toast={toast} />
    </main>
  );
}