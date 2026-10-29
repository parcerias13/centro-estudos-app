'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Loader2, UploadCloud, AlertTriangle, CheckCircle2, Copy, KeyRound } from 'lucide-react';
import {
  mapearLinha, nomeUtilizadorDoAluno, chaveIdentidadeAluno, detetarHomonimosNoFicheiro,
  fraseJaExisteComoModalidade, LinhaImportacao,
} from './importAlunosConfig';
import { useStatusToast, StatusToast } from '@/lib/statusToast';

interface ResultadoImportacao {
  linhaExcel: number;
  nome: string;
  motivo: string;
}

interface AcessoGerado {
  nome: string;
  anoEscolar: number | null;
  dataNascimento: string | null;
  nomeUtilizador: string;
  password: string;
  codigo: string | null;
}

// "2026-03-15" -> "15/03/2026" — só para mostrar (a app guarda sempre ISO).
// Sem data (campo opcional): string vazia, nunca '—'/null/NaN — nem na
// pré-visualização, nem na tabela de acessos, nem no texto do "Copiar tudo".
function paraDataPT(iso: string | null): string {
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

interface Props {
  file: File;
  onClose: () => void;
  onImported: () => void;
}

type Estado = 'a_ler' | 'preview' | 'a_importar' | 'relatorio';

export default function ImportarAlunosModal({ file, onClose, onImported }: Props) {
  const { toast, showError } = useStatusToast();
  const [estado, setEstado] = useState<Estado>('a_ler');
  const [linhas, setLinhas] = useState<LinhaImportacao[]>([]);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);

  const [progresso, setProgresso] = useState(0);
  const [criados, setCriados] = useState(0);
  const [ignoradas, setIgnoradas] = useState<ResultadoImportacao[]>([]);
  const [acessosGerados, setAcessosGerados] = useState<AcessoGerado[]>([]);
  const [copiadoTudo, setCopiadoTudo] = useState(false);
  const [jaCopiou, setJaCopiou] = useState(false);

  useEffect(() => {
    const ler = async () => {
      try {
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const linhasBrutas = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

        if (linhasBrutas.length === 0) {
          setErroLeitura('O ficheiro não tem linhas de dados (para além do cabeçalho).');
          return;
        }

        const mapeadas = linhasBrutas.map((linha, i) => mapearLinha(linha, i + 2));

        // Homónimos dentro do próprio ficheiro (mesmo nome + ano escolar, sem
        // Nome de Utilizador que os distinga) — bloqueados já na
        // pré-visualização, nunca importados em silêncio. Junta-se ao erros
        // de cada linha para reaproveitar toda a contagem/filtragem existente
        // (válidas vs. com erro) e a listagem em "ignoradas" no relatório.
        const bloqueios = detetarHomonimosNoFicheiro(mapeadas.filter((l) => l.erros.length === 0));
        const comHomonimos = bloqueios.size === 0
          ? mapeadas
          : mapeadas.map((l) => (bloqueios.has(l.linhaExcel) ? { ...l, erros: [...l.erros, bloqueios.get(l.linhaExcel)!] } : l));

        setLinhas(comHomonimos);
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
    const acessos: AcessoGerado[] = [];

    if (!centro_id) {
      resultadosIgnorados.push(
        ...linhasValidas.map((l) => ({
          linhaExcel: l.linhaExcel,
          nome: l.dados.nome,
          motivo: 'Não foi possível obter o centro do administrador autenticado.',
        }))
      );
    } else {
      // Idempotência: duas importações do mesmo ficheiro (ou duas linhas do
      // mesmo ficheiro) com o mesmo nome e ano escolar são o mesmo aluno —
      // não se cria uma segunda conta. Os homónimos DENTRO do ficheiro já
      // foram bloqueados na pré-visualização (ver detetarHomonimosNoFicheiro,
      // chamado em ler()); linhasValidas aqui já não os inclui. O nome de
      // utilizador já não serve para esta deteção (colisões de login
      // resolvem-se sozinhas, com sufixo automático, em
      // app/api/admin/criar-aluno).
      const { data: existentes } = await supabase.from('alunos').select('nome, ano_escolar, sala_estudo, faz_explicacoes').eq('centro_id', centro_id);
      const existentesPorChave = new Map((existentes || []).map((a: any) => [chaveIdentidadeAluno(a.nome, a.ano_escolar), a]));

      for (let i = 0; i < linhasValidas.length; i++) {
        const linha = linhasValidas[i];
        const chave = chaveIdentidadeAluno(linha.dados.nome, linha.dados.ano_escolar);
        const existente = existentesPorChave.get(chave);

        if (existente) {
          resultadosIgnorados.push({
            linhaExcel: linha.linhaExcel,
            nome: `${linha.dados.nome} (${linha.dados.ano_escolar}.º ano)`,
            motivo: fraseJaExisteComoModalidade(!!existente.sala_estudo, !!existente.faz_explicacoes),
          });
          setProgresso(i + 1);
          continue;
        }

        try {
          const res = await fetch('/api/admin/criar-aluno', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nome: linha.dados.nome,
              nome_utilizador_override: linha.dados.nome_utilizador || undefined,
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
              dias_selecionados: linha.dados.dias_selecionados,
              sala_estudo: linha.dados.sala_estudo,
              faz_explicacoes: linha.dados.faz_explicacoes,
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
            acessos.push({
              nome: linha.dados.nome,
              anoEscolar: linha.dados.ano_escolar,
              dataNascimento: linha.dados.data_nascimento,
              nomeUtilizador: body.nomeUtilizador,
              password: body.password,
              codigo: body.codigo ?? null,
            });
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
    setAcessosGerados(acessos);
    setEstado('relatorio');
  };

  const handleCopiarTudo = async () => {
    const texto = [
      'Aluno\tAno\tNascimento\tUtilizador\tPalavra-passe\tCódigo',
      ...acessosGerados.map((a) => `${a.nome}\t${a.anoEscolar ?? ''}\t${paraDataPT(a.dataNascimento)}\t${a.nomeUtilizador}\t${a.password}\t${a.codigo ?? 'SEM CÓDIGO — gerar na ficha'}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      setCopiadoTudo(true);
      setJaCopiou(true);
      setTimeout(() => setCopiadoTudo(false), 3000);
    } catch {
      showError('Não foi possível copiar — a lista fica visível no ecrã para copiares à mão.');
    }
  };

  const temAcessosPorCopiar = acessosGerados.length > 0 && !jaCopiou;

  const handleFechar = () => {
    if (temAcessosPorCopiar && !confirm('Ainda não copiaste os acessos gerados — só são mostrados uma vez. Fechar sem copiar?')) return;
    onClose();
  };

  const handleConcluir = () => {
    if (temAcessosPorCopiar && !confirm('Ainda não copiaste os acessos gerados — só são mostrados uma vez. Continuar sem copiar?')) return;
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
            <button onClick={handleFechar} className="text-muted hover:text-primary transition-colors">
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
              {(() => {
                // Nomes de utilizador previstos repetidos dentro do próprio
                // ficheiro — não bloqueia (resolve-se com sufixo automático
                // em app/api/admin/criar-aluno), mas avisa para não trocar o
                // utilizador entre dois alunos homónimos.
                const contagemUtilizadorPrevisto = new Map<string, number>();
                linhasValidas.forEach((l) => {
                  const u = nomeUtilizadorDoAluno(l.dados);
                  contagemUtilizadorPrevisto.set(u, (contagemUtilizadorPrevisto.get(u) || 0) + 1);
                });
                return (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-page text-muted uppercase text-[10px] font-black tracking-widest">
                    <tr>
                      <th className="p-3 text-left">Linha</th>
                      <th className="p-3 text-left">Nome</th>
                      <th className="p-3 text-left">Data Nasc.</th>
                      <th className="p-3 text-left">Utilizador Previsto</th>
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
                        <td className="p-3">{l.dados.data_nascimento || ''}</td>
                        <td className="p-3 font-mono">{l.erros.length === 0 ? nomeUtilizadorDoAluno(l.dados) : '—'}</td>
                        <td className="p-3">{l.dados.email_encarregado || '—'}</td>
                        <td className="p-3">{l.dados.ano_escolar ?? 'null'}</td>
                        <td className="p-3">{l.dados.mensalidade_base ?? 'null'}</td>
                        <td className="p-3 text-xs">
                          {l.erros.length > 0 ? (
                            l.erros.join('; ')
                          ) : (contagemUtilizadorPrevisto.get(nomeUtilizadorDoAluno(l.dados)) ?? 0) > 1 ? (
                            <span className="text-warning">
                              Nome repetido: este aluno ficará com um número no fim. Se preferires, indica outro na coluna Nome de Utilizador do Aluno
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                );
              })()}
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

              {acessosGerados.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-primary font-black text-sm flex items-center gap-2">
                      <KeyRound size={16} className="text-accent" /> Acessos gerados — guarda-os agora, só aparecem uma vez
                    </p>
                    <button
                      onClick={handleCopiarTudo}
                      className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-on-accent px-4 py-2 rounded-xl font-black text-xs transition-all active:scale-95"
                    >
                      <Copy size={14} /> {copiadoTudo ? 'Copiado!' : 'Copiar tudo'}
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-page text-muted uppercase text-[10px] font-black tracking-widest">
                        <tr>
                          <th className="p-3 text-left">Aluno</th>
                          <th className="p-3 text-left">Ano</th>
                          <th className="p-3 text-left">Nascimento</th>
                          <th className="p-3 text-left">Utilizador</th>
                          <th className="p-3 text-left">Palavra-passe</th>
                          <th className="p-3 text-left">Código</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acessosGerados.map((a, i) => (
                          <tr key={i} className="border-t border-border text-secondary">
                            <td className="p-3 font-bold">{a.nome}</td>
                            <td className="p-3">{a.anoEscolar ?? '—'}</td>
                            <td className="p-3">{paraDataPT(a.dataNascimento)}</td>
                            <td className="p-3 font-mono">{a.nomeUtilizador}</td>
                            <td className="p-3 font-mono">{a.password}</td>
                            <td className="p-3 font-mono">
                              {a.codigo ?? <span className="text-warning">sem código — gerar na ficha</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

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
              <button onClick={handleFechar} className="px-6 py-3 rounded-xl font-black text-secondary hover:text-primary transition-colors">
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
      <StatusToast toast={toast} />
    </div>
  );
}
