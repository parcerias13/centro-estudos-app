import { getHojeLisboa } from './dataLisboa';

/**
 * Datas de abertura de cada período letivo — aproximação do calendário
 * escolar português, a rever. Fica num único sítio para ser fácil de
 * ajustar. Isto é regra de usabilidade da UI (esconde/bloqueia o período
 * antes da data); a base de dados não a impõe.
 *
 * `anoDoAnoLetivo: 'inicio' | 'fim'` diz a que metade do ano_letivo
 * (ex: "2026/2027") o mês pertence — 1º período abre no ano de início
 * (setembro de 2026), 2º e 3º abrem no ano de fim (janeiro/abril de 2027).
 */
export const ABERTURA_PERIODOS: Record<1 | 2 | 3, { mes: number; dia: number; anoDoAnoLetivo: 'inicio' | 'fim' }> = {
  1: { mes: 9, dia: 1, anoDoAnoLetivo: 'inicio' }, // setembro
  2: { mes: 1, dia: 1, anoDoAnoLetivo: 'fim' },    // janeiro
  3: { mes: 4, dia: 1, anoDoAnoLetivo: 'fim' },    // abril
};

/**
 * O período já abriu para o ano letivo dado (ex: "2026/2027")? Compara
 * sempre com getHojeLisboa() — nunca com `new Date()` local.
 */
export function periodoJaAbriu(periodo: 1 | 2 | 3, anoLetivo: string, hoje: string = getHojeLisboa()): boolean {
  const [anoInicio] = anoLetivo.split('/').map(Number);
  const cfg = ABERTURA_PERIODOS[periodo];
  const ano = cfg.anoDoAnoLetivo === 'fim' ? anoInicio + 1 : anoInicio;
  const dataAbertura = `${ano}-${String(cfg.mes).padStart(2, '0')}-${String(cfg.dia).padStart(2, '0')}`;
  return hoje >= dataAbertura;
}
