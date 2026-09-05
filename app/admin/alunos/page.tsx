'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { UserPlus, Search, FileBarChart, Edit, Trash2, ShieldCheck, ShieldAlert, Loader2, ArrowLeft, Users, Filter, FileText, FileSpreadsheet, UploadCloud, Receipt } from 'lucide-react';
import { CABECALHOS, LINHA_EXEMPLO } from './importAlunosConfig';
import ImportarAlunosModal from './ImportarAlunosModal';
import ExportarFaturacaoModal from './ExportarFaturacaoModal';


export default function ListaAlunos() {
  const [alunos, setAlunos] = useState<any[]>([]);
  const [busca, setBusca] = useState('');
  const [filtroAno, setFiltroAno] = useState('');
  const [loading, setLoading] = useState(true);
  const [ficheiroImportacao, setFicheiroImportacao] = useState<File | null>(null);
  const inputImportacaoRef = useRef<HTMLInputElement>(null);
  const [mostrarExportarFaturacao, setMostrarExportarFaturacao] = useState(false);

  useEffect(() => { fetchAlunos(); }, []);

  const fetchAlunos = async () => {
    setLoading(true);
    try {
      const hoje = new Date();
      const diaDaSemana = hoje.getDay() === 0 ? 6 : hoje.getDay() - 1;
      const inicioSemana = new Date(hoje);
      inicioSemana.setDate(hoje.getDate() - diaDaSemana);
      inicioSemana.setHours(0, 0, 0, 0);

      const fimSemana = new Date(inicioSemana);
      fimSemana.setDate(inicioSemana.getDate() + 6);
      fimSemana.setHours(23, 59, 59, 999);

      const { data: dataAlunos, error: errAlunos } = await supabase
        .from('alunos')
        .select('*')
        .order('nome', { ascending: true });

      const { data: dataPresencas, error: errPresencas } = await supabase
        .from('diario_bordo')
        .select('aluno_id')
        .gte('created_at', inicioSemana.toISOString())
        .lte('created_at', fimSemana.toISOString())
        .neq('status', 'falta');

      if (dataAlunos && dataPresencas) {
        const alunosProcessados = dataAlunos.map(aluno => {
          const contagem = dataPresencas.filter(p => p.aluno_id === aluno.id).length;
          return {
            ...aluno,
            consumo_semanal: contagem
          };
        });

        const alunosOrdenados = alunosProcessados.sort((a, b) => {
          const alertaA = (a.consumo_semanal >= a.limite_semanal && a.limite_semanal !== 99) ? 1 : 0;
          const alertaB = (b.consumo_semanal >= b.limite_semanal && b.limite_semanal !== 99) ? 1 : 0;
          
          if (alertaA !== alertaB) return alertaB - alertaA; 
          return a.nome.localeCompare(b.nome); 
        });

        setAlunos(alunosOrdenados);
      } else if (dataAlunos) {
        setAlunos(dataAlunos);
      }
    } catch (error) {
      console.error('Erro ao processar prioridades:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem a certeza que quer apagar este aluno? Todo o histórico será perdido.')) {
      const { error } = await supabase.from('alunos').delete().eq('id', id);
      if (error) {
        alert('Erro ao apagar: ' + error.message);
      } else {
        fetchAlunos(); 
      }
    }
  };

  const handleDownloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Alunos');

    sheet.addRow([...CABECALHOS]);
    sheet.addRow(LINHA_EXEMPLO);

    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    });

    sheet.getRow(2).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    });

    sheet.columns.forEach((coluna, i) => {
      const cabecalho = CABECALHOS[i]?.length ?? 0;
      const exemplo = String(LINHA_EXEMPLO[i] ?? '').length;
      coluna.width = Math.max(18, cabecalho + 2, exemplo + 2);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'template_importacao_alunos.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileSelecionado = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFicheiroImportacao(file);
    e.target.value = '';
  };

  const alunosFiltrados = alunos.filter(a => {
    const matchesNome = a.nome?.toLowerCase().includes(busca.toLowerCase());
    const matchesAno = filtroAno === '' || String(a.ano_escolar) === filtroAno;
    return matchesNome && matchesAno;
  });

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;

  return (
    <div className="min-h-screen bg-page p-6 text-primary font-sans">
      
      <header className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="bg-surface p-3 rounded-xl hover:bg-raised transition-colors border border-border">
            <ArrowLeft size={20} className="text-secondary" />
          </Link>
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-2 italic uppercase">
                <Users className="text-accent" size={28} /> Gerir Alunos
            </h1>
            <p className="text-muted text-xs font-black uppercase tracking-widest">{alunos.length} Matrículas Ativas</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleDownloadTemplate}
            className="bg-surface hover:bg-raised text-secondary px-5 py-3 rounded-2xl font-black flex items-center gap-2 border border-border transition-all active:scale-95"
          >
            <FileSpreadsheet size={18} /> TEMPLATE
          </button>

          <button
            onClick={() => inputImportacaoRef.current?.click()}
            className="bg-surface hover:bg-raised text-secondary px-5 py-3 rounded-2xl font-black flex items-center gap-2 border border-border transition-all active:scale-95"
          >
            <UploadCloud size={18} /> IMPORTAR EXCEL
          </button>
          <input
            ref={inputImportacaoRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelecionado}
            className="hidden"
          />

          <button
            onClick={() => setMostrarExportarFaturacao(true)}
            className="bg-surface hover:bg-raised text-secondary px-5 py-3 rounded-2xl font-black flex items-center gap-2 border border-border transition-all active:scale-95"
          >
            <Receipt size={18} /> EXPORTAR FATURAÇÃO
          </button>

          <Link href="/admin/alunos/novo" className="bg-accent hover:bg-accent-hover text-on-accent px-6 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg shadow-accent/20 transition-all active:scale-95">
            <UserPlus size={20} /> NOVA MATRÍCULA
          </Link>
        </div>
      </header>

      {ficheiroImportacao && (
        <ImportarAlunosModal
          file={ficheiroImportacao}
          onClose={() => setFicheiroImportacao(null)}
          onImported={fetchAlunos}
        />
      )}

      {mostrarExportarFaturacao && (
        <ExportarFaturacaoModal
          alunos={alunos}
          onClose={() => setMostrarExportarFaturacao(false)}
        />
      )}

      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
          <input 
            type="text" 
            placeholder="Pesquisar por nome do aluno..." 
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-surface/50 border border-border p-5 pl-14 rounded-2xl outline-none focus:border-accent transition-all text-lg font-medium placeholder:text-muted"
          />
        </div>

        <div className="relative w-full md:w-64">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
          <select 
            value={filtroAno}
            onChange={(e) => setFiltroAno(e.target.value)}
            className="w-full bg-surface/50 border border-border p-5 pl-14 rounded-2xl outline-none focus:border-accent transition-all text-lg font-medium appearance-none cursor-pointer text-secondary"
          >
            <option value="">Todos os Anos</option>
            {[...Array(12)].map((_, i) => (
              <option key={i + 1} value={i + 1}>{i + 1}º Ano</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {alunosFiltrados.length === 0 ? (
          <div className="col-span-full text-center py-20 bg-surface/70 border-2 border-dashed border-border rounded-3xl">
            <p className="text-muted font-medium italic">Nenhum aluno encontrado.</p>
          </div>
        ) : (
          alunosFiltrados.map((aluno) => (
            <div key={aluno.id} className="bg-surface border border-border/60 hover:border-border p-5 rounded-3xl flex flex-col sm:flex-row sm:items-center sm:justify-between group transition-all shadow-sm">
              <div className="flex items-center gap-5 flex-1 min-w-0">
                <div className="w-14 h-14 shrink-0 bg-raised rounded-2xl flex items-center justify-center text-xl font-black text-muted group-hover:bg-accent group-hover:text-on-accent transition-all overflow-hidden border border-border/50 shadow-inner">
                  {aluno.avatar_url ? (
                    <img src={aluno.avatar_url} alt={aluno.nome} className="w-full h-full object-cover" />
                  ) : (
                    <span>{aluno.nome?.charAt(0)}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-primary leading-tight truncate uppercase italic">{aluno.nome}</h3>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 bg-raised text-secondary rounded-md border border-border">
                      {aluno.ano_escolar}º ANO
                    </span>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1 ${aluno.saida_autorizada ? 'bg-success-bg text-success border border-success/20' : 'bg-danger-bg text-danger border border-danger/20'}`}>
                      {aluno.saida_autorizada ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />}
                      {aluno.saida_autorizada ? 'Autónomo' : 'Restrito'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3 sm:mt-0 sm:ml-4 shrink-0">
                {/* BOTÃO DO EXTRATO INDIVIDUAL (DOSSIER) */}
                <Link 
                  href={`/admin/alunos/extrato?id=${aluno.id}`} 
                  className="p-3 bg-raised text-accent hover:bg-accent hover:text-on-accent rounded-xl transition-all border border-border hover:border-accent shadow-xl"
                  title="Extrato Detalhado por Dia"
                >
                  <FileText size={20} />
                </Link>

                <Link 
                  href={`/admin/relatorio?id=${aluno.id}`} 
                  className="p-3 bg-raised text-secondary hover:bg-accent hover:text-on-accent rounded-xl transition-all border border-border hover:border-accent shadow-xl"
                  title="Ver Relatório de Performance"
                >
                  <FileBarChart size={20} />
                </Link>

                <Link 
                  href={`/admin/alunos/editar?id=${aluno.id}`} 
                  className="p-3 bg-raised text-secondary hover:bg-accent hover:text-on-accent rounded-xl transition-all border border-border hover:border-accent shadow-xl"
                  title="Editar Aluno"
                >
                  <Edit size={20} />
                </Link>

                <button 
                  onClick={() => handleDelete(aluno.id)}
                  className="p-3 bg-raised text-secondary hover:bg-danger hover:text-on-danger rounded-xl transition-all border border-border hover:border-danger shadow-xl"
                  title="Remover Matrícula"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}