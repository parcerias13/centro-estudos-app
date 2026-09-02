'use client';

import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { X, Loader2, UploadCloud, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { mapearLinha, gerarPasswordAleatoria, LinhaImportacao } from './importAlunosConfig';

interface ResultadoImportacao {
  linhaExcel: number;
  nome: string;
  motivo: string;
}

interface Props {
  file: File;
  onClose: () => void;
  onImported: () => void;
}

type Estado = 'a_ler' | 'preview' | 'a_importar' | 'relatorio';

export default function ImportarAlunosModal({ file, onClose, onImported }: Props) {
  const [estado, setEstado] = useState<Estado>('a_ler');
  const [linhas, setLinhas] = useState<LinhaImportacao[]>([]);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);

  const [progresso, setProgresso] = useState(0);
  const [criados, setCriados] = useState(0);
  const [ignoradas, setIgnoradas] = useState<ResultadoImportacao[]>([]);

  useEffect(() => {
    const ler = async () => {
      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const linhasBrutas = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

        if (linhasBrutas.length === 0) {
          setErroLeitura('O ficheiro não tem linhas de dados (para além do cabeçalho).');
          return;
        }

        const mapeadas = linhasBrutas.map((linha, i) => mapearLinha(linha, i + 2));
        setLinhas(mapeadas);
        setEstado('preview');
      } catch (err: any) {
        setErroLeitura('Não foi possível ler o ficheiro: ' + err.message);
      }
    };
    ler();
  }, [file]);

  const linhasValidas = linhas.filter((l) => l.erros.length === 0);
  const linhasComErro = linhas.filter((l) => l.erros.length > 0);

  const handleConfirmarImportacao = async () => {
    setEstado('a_importar');
    setProgresso(0);

    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;

    const resultadosIgnorados: ResultadoImportacao[] = linhasComErro.map((l) => ({
      linhaExcel: l.linhaExcel,
      nome: l.dados.nome || `Linha ${l.linhaExcel}`,
      motivo: l.erros.join('; '),
    }));

    let totalCriados = 0;

    if (!centro_id) {
      resultadosIgnorados.push(
        ...linhasValidas.map((l) => ({
          linhaExcel: l.linhaExcel,
          nome: l.dados.nome,
          motivo: 'Não foi possível obter o centro do administrador autenticado.',
        }))
      );
    } else {
      for (let i = 0; i < linhasValidas.length; i++) {
        const linha = linhasValidas[i];
        try {
          const res = await fetch('/api/admin/criar-aluno', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: linha.dados.email_encarregado,
              password: gerarPasswordAleatoria(),
              nome: linha.dados.nome,
              data_nascimento: linha.dados.data_nascimento,
              telefone_encarregado: linha.dados.telefone_encarregado,
              email_encarregado: linha.dados.email_encarregado,
              nif_encarregado: linha.dados.nif_encarregado,
              morada_encarregado: linha.dados.morada_encarregado,
              telemovel_aluno: linha.dados.telemovel_aluno,
              ano_escolar: linha.dados.ano_escolar,
              mensalidade_base: linha.dados.mensalidade_base,
              saida_autorizada: linha.dados.saida_autorizada,
              consentimento_ia: false,
              usa_app: linha.dados.usa_app,
              avatar_url: null,
              centro_id,
              dias_selecionados: linha.dados.dias_selecionados,
            }),
          });

          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            resultadosIgnorados.push({
              linhaExcel: linha.linhaExcel,
              nome: linha.dados.nome,
              motivo: body?.error || `Erro (${res.status})`,
            });
          } else {
            totalCriados++;
          }
        } catch (err: any) {
          resultadosIgnorados.push({
            linhaExcel: linha.linhaExcel,
            nome: linha.dados.nome,
            motivo: err.message || 'Erro de rede desconhecido',
          });
        }
        setProgresso(i + 1);
      }
    }

    resultadosIgnorados.sort((a, b) => a.linhaExcel - b.linhaExcel);
    setCriados(totalCriados);
    setIgnoradas(resultadosIgnorados);
    setEstado('relatorio');
  };

  const handleConcluir = () => {
    if (criados > 0) onImported();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <UploadCloud className="text-accent" size={22} />
            <h2 className="text-lg font-black text-primary uppercase tracking-tight">Importar Alunos</h2>
          </div>
          {estado !== 'a_importar' && (
            <button onClick={onClose} className="text-muted hover:text-primary transition-colors">
              <X size={22} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {estado === 'a_ler' && (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-secondary">
              <Loader2 className="animate-spin text-accent" size={32} />
              <p className="font-bold text-sm">A ler o ficheiro...</p>
            </div>
          )}

          {erroLeitura && (
            <div className="bg-danger-bg border border-danger/30 p-4 rounded-xl flex items-start gap-3 text-danger">
              <AlertTriangle className="shrink-0" size={20} />
              <p className="text-sm font-bold">{erroLeitura}</p>
            </div>
          )}

          {estado === 'preview' && (
            <>
              <div className="flex gap-4 mb-4 text-sm font-black">
                <span className="text-success">{linhasValidas.length} válidas</span>
                <span className="text-danger">{linhasComErro.length} com erro</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-page text-muted uppercase text-[10px] font-black tracking-widest">
                    <tr>
                      <th className="p-3 text-left">Linha</th>
                      <th className="p-3 text-left">Nome</th>
                      <th className="p-3 text-left">Data Nasc.</th>
                      <th className="p-3 text-left">Email Encarregado</th>
                      <th className="p-3 text-left">Ano</th>
                      <th className="p-3 text-left">Mensalidade</th>
                      <th className="p-3 text-left">Erros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr
                        key={l.linhaExcel}
                        className={`border-t border-border ${l.erros.length > 0 ? 'bg-danger-bg text-danger' : 'text-secondary'}`}
                      >
                        <td className="p-3 font-mono">{l.linhaExcel}</td>
                        <td className="p-3 font-bold">{l.dados.nome || '—'}</td>
                        <td className="p-3">{l.dados.data_nascimento || '—'}</td>
                        <td className="p-3">{l.dados.email_encarregado || '—'}</td>
                        <td className="p-3">{l.dados.ano_escolar ?? 'null'}</td>
                        <td className="p-3">{l.dados.mensalidade_base ?? 'null'}</td>
                        <td className="p-3 text-xs">{l.erros.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {estado === 'a_importar' && (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-secondary">
              <Loader2 className="animate-spin text-accent" size={32} />
              <p className="font-bold text-sm">A importar {progresso} / {linhasValidas.length}...</p>
            </div>
          )}

          {estado === 'relatorio' && (
            <div className="space-y-6">
              <div className="bg-success-bg border border-success/30 p-4 rounded-xl flex items-center gap-3 text-success">
                <CheckCircle2 size={22} />
                <p className="font-black">{criados} aluno(s) criado(s) com sucesso.</p>
              </div>

              {ignoradas.length > 0 && (
                <div>
                  <p className="text-danger font-black text-sm mb-3">{ignoradas.length} linha(s) ignorada(s):</p>
                  <div className="space-y-2">
                    {ignoradas.map((r) => (
                      <div key={r.linhaExcel} className="bg-danger-bg border border-danger/20 p-3 rounded-lg text-sm">
                        <span className="font-bold text-danger">Linha {r.linhaExcel} ({r.nome}):</span>{' '}
                        <span className="text-secondary">{r.motivo}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border flex justify-end gap-3">
          {estado === 'preview' && (
            <>
              <button onClick={onClose} className="px-6 py-3 rounded-xl font-black text-secondary hover:text-primary transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleConfirmarImportacao}
                disabled={linhasValidas.length === 0}
                className="bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-on-accent px-6 py-3 rounded-2xl font-black transition-all active:scale-95"
              >
                Confirmar Importação
              </button>
            </>
          )}
          {estado === 'relatorio' && (
            <button
              onClick={handleConcluir}
              className="bg-accent hover:bg-accent-hover text-on-accent px-6 py-3 rounded-2xl font-black transition-all active:scale-95"
            >
              Concluir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
