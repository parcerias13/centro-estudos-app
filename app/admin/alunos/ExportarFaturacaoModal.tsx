'use client';

import { useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { supabase } from '@/lib/supabase';
import { X, Receipt, Users, UserCheck, Loader2 } from 'lucide-react';

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const CABECALHOS = [
  'Nome do Aluno',
  'NIF Encarregado',
  'Morada Encarregado',
  'Email Encarregado',
  'Telefone Encarregado',
  'Mensalidade Base',
  'Total Extras',
  'Total a Pagar',
  'Mês de Referência',
];

interface Props {
  alunos: any[];
  onClose: () => void;
}

type Modo = 'todos' | 'selecionar';

function normalizarNomeFicheiro(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export default function ExportarFaturacaoModal({ alunos, onClose }: Props) {
  const [modo, setModo] = useState<Modo>('todos');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const alunosOrdenados = useMemo(
    () => [...alunos].sort((a, b) => (a.nome || '').localeCompare(b.nome || '')),
    [alunos]
  );

  const toggleSelecionado = (id: string) => {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const selecionarTodos = () => setSelecionados(new Set(alunosOrdenados.map((a) => a.id)));
  const limparSelecao = () => setSelecionados(new Set());

  const alunosAlvo = modo === 'todos' ? alunosOrdenados : alunosOrdenados.filter((a) => selecionados.has(a.id));

  const podeGerar = alunosAlvo.length > 0 && !gerando;

  const handleGerarExcel = async () => {
    if (alunosAlvo.length === 0) return;
    setGerando(true);
    setErro(null);

    try {
      const primeiroDia = `${ano}-${String(mes).padStart(2, '0')}-01`;
      const ultimoDiaNum = new Date(ano, mes, 0).getDate();
      const ultimoDia = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDiaNum).padStart(2, '0')}`;

      const idsAlvo = alunosAlvo.map((a) => a.id);

      const { data: consumos, error: consumosError } = await supabase
        .from('consumos_diarios')
        .select('aluno_id, preco_aplicado')
        .in('aluno_id', idsAlvo)
        .gte('data_consumo', primeiroDia)
        .lte('data_consumo', ultimoDia);

      if (consumosError) throw consumosError;

      const totalExtrasPorAluno: Record<string, number> = {};
      consumos?.forEach((c) => {
        totalExtrasPorAluno[c.aluno_id] = (totalExtrasPorAluno[c.aluno_id] || 0) + (Number(c.preco_aplicado) || 0);
      });

      const mesReferencia = `${NOMES_MESES[mes - 1]} ${ano}`;

      const linhas = alunosAlvo.map((a) => {
        const mensalidade = Number(a.mensalidade_base) || 0;
        const extras = totalExtrasPorAluno[a.id] || 0;
        return [
          a.nome || '',
          a.nif_encarregado || '',
          a.morada_encarregado || '',
          a.email_encarregado || '',
          a.telefone_encarregado || '',
          mensalidade,
          extras,
          mensalidade + extras,
          mesReferencia,
        ];
      });

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Faturação');

      sheet.addRow(CABECALHOS);
      linhas.forEach((linha) => sheet.addRow(linha));

      sheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      });

      for (let i = 2; i <= linhas.length + 1; i++) {
        const row = sheet.getRow(i);
        if (i % 2 === 0) {
          row.eachCell({ includeEmpty: true }, (cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          });
        }
        row.getCell(6).numFmt = '0.00';
        row.getCell(7).numFmt = '0.00';
        row.getCell(8).numFmt = '0.00';
        row.getCell(8).font = { bold: true };
      }

      sheet.columns.forEach((coluna, i) => {
        const valores = [CABECALHOS[i], ...linhas.map((linha) => String(linha[i] ?? ''))];
        coluna.width = Math.max(...valores.map((v) => v.length)) + 2;
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `faturacao_${normalizarNomeFicheiro(NOMES_MESES[mes - 1])}_${ano}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);

      onClose();
    } catch (err: any) {
      setErro('Erro ao gerar o Excel: ' + err.message);
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <Receipt className="text-blue-500" size={22} />
            <h2 className="text-lg font-black text-white uppercase tracking-tight">Exportar Faturação</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {erro && (
            <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl text-red-500 text-sm font-bold">
              {erro}
            </div>
          )}

          <div>
            <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-3">Alunos a Incluir</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setModo('todos')}
                className={`p-4 rounded-2xl border flex items-center gap-3 transition-all ${modo === 'todos' ? 'bg-blue-600/10 border-blue-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}
              >
                <Users size={20} />
                <div className="text-left">
                  <p className="font-bold text-sm">Todos os Alunos</p>
                  <p className="text-[10px] uppercase font-black text-slate-500">{alunosOrdenados.length} no total</p>
                </div>
              </button>
              <button
                onClick={() => setModo('selecionar')}
                className={`p-4 rounded-2xl border flex items-center gap-3 transition-all ${modo === 'selecionar' ? 'bg-blue-600/10 border-blue-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}
              >
                <UserCheck size={20} />
                <div className="text-left">
                  <p className="font-bold text-sm">Selecionar Alunos</p>
                  <p className="text-[10px] uppercase font-black text-slate-500">{selecionados.size} selecionado(s)</p>
                </div>
              </button>
            </div>
          </div>

          {modo === 'selecionar' && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Lista de Alunos</p>
                <div className="flex gap-3">
                  <button onClick={selecionarTodos} className="text-[10px] font-black uppercase text-blue-500 hover:text-blue-400">Selecionar Todos</button>
                  <button onClick={limparSelecao} className="text-[10px] font-black uppercase text-slate-500 hover:text-slate-400">Limpar</button>
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl max-h-56 overflow-y-auto p-2 space-y-1">
                {alunosOrdenados.map((a) => (
                  <label key={a.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selecionados.has(a.id)}
                      onChange={() => toggleSelecionado(a.id)}
                      className="accent-blue-600"
                    />
                    <span className="text-sm text-slate-300">{a.nome}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-3">Mês de Referência</p>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={mes}
                onChange={(e) => setMes(parseInt(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all text-white appearance-none cursor-pointer"
              >
                {NOMES_MESES.map((nome, i) => (
                  <option key={i + 1} value={i + 1}>{nome}</option>
                ))}
              </select>
              <input
                type="number"
                value={ano}
                onChange={(e) => setAno(parseInt(e.target.value) || ano)}
                className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all text-white"
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-slate-800 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-3 rounded-xl font-black text-slate-400 hover:text-white transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleGerarExcel}
            disabled={!podeGerar}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 transition-all active:scale-95"
          >
            {gerando ? <Loader2 className="animate-spin" size={18} /> : <Receipt size={18} />}
            {gerando ? 'A GERAR...' : 'GERAR EXCEL'}
          </button>
        </div>
      </div>
    </div>
  );
}
