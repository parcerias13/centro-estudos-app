import { test, expect } from '@playwright/test';
import {
  cicloDoAno,
  escolherPrecoPorAlunos,
  valorCobrado,
  parseValorEuro,
  valorEuroValido,
  formatarValorPtPt,
  agruparPrecosCiclo,
  validarLinhasCiclo,
  type PrecoCiclo,
} from '@/lib/precosCiclo';

// Testes de lógica pura de lib/precosCiclo.ts — sem Supabase, sem browser.
// Mesma escolha de preço do gatilho calcular_valores_explicacao (nunca
// reimplementado aqui, só espelhado para o simulador e para ler/escrever a
// tabela); se estes passarem, a Gestão e o gatilho nunca podem divergir
// para os mesmos dados.

test.describe('lib/precosCiclo — cicloDoAno (fronteiras)', () => {
  test('1.º ao 4.º ano = 1_ciclo', () => {
    expect(cicloDoAno(1)).toBe('1_ciclo');
    expect(cicloDoAno(4)).toBe('1_ciclo');
  });
  test('5.º e 6.º ano = 2_ciclo', () => {
    expect(cicloDoAno(5)).toBe('2_ciclo');
    expect(cicloDoAno(6)).toBe('2_ciclo');
  });
  test('7.º ao 9.º ano = 3_ciclo', () => {
    expect(cicloDoAno(7)).toBe('3_ciclo');
    expect(cicloDoAno(9)).toBe('3_ciclo');
  });
  test('10.º ao 12.º ano = secundario', () => {
    expect(cicloDoAno(10)).toBe('secundario');
    expect(cicloDoAno(12)).toBe('secundario');
  });
});

test.describe('lib/precosCiclo — escolherPrecoPorAlunos (escolha por nº de alunos)', () => {
  const precos = [
    { alunosAPartirDe: 1, valor: 16 },
    { alunosAPartirDe: 2, valor: 12 },
  ];
  test('1 aluno escolhe o individual (escalão 1)', () => {
    expect(escolherPrecoPorAlunos(precos, 1)?.valor).toBe(16);
  });
  test('2 alunos escolhe o de grupo (escalão 2)', () => {
    expect(escolherPrecoPorAlunos(precos, 2)?.valor).toBe(12);
  });
  test('3 alunos continua no de grupo (maior escalão que não excede)', () => {
    expect(escolherPrecoPorAlunos(precos, 3)?.valor).toBe(12);
  });
  test('5 alunos continua no de grupo (sem escalão específico para 5)', () => {
    expect(escolherPrecoPorAlunos(precos, 5)?.valor).toBe(12);
  });
  test('sem nenhuma linha aplicável devolve null (ciclo sem preço)', () => {
    expect(escolherPrecoPorAlunos([], 1)).toBeNull();
  });
  test('1.º ciclo sem grupo (só escalão 1): 2 alunos paga o mesmo que 1 — "igual ao individual"', () => {
    const soIndividual = [{ alunosAPartirDe: 1, valor: 16 }];
    expect(escolherPrecoPorAlunos(soIndividual, 1)?.valor).toBe(16);
    expect(escolherPrecoPorAlunos(soIndividual, 2)?.valor).toBe(16);
    expect(escolherPrecoPorAlunos(soIndividual, 5)?.valor).toBe(16);
  });
});

test.describe('lib/precosCiclo — valorCobrado (por hora vs por sessão)', () => {
  test('por_hora multiplica pelas horas dadas', () => {
    expect(valorCobrado({ tipo: 'por_hora', valor: 16 }, 1)).toBe(16);
    expect(valorCobrado({ tipo: 'por_hora', valor: 16 }, 2)).toBe(32);
    expect(valorCobrado({ tipo: 'por_hora', valor: 16 }, 0.5)).toBe(8);
  });
  test('fixo (por sessão) ignora as horas', () => {
    expect(valorCobrado({ tipo: 'fixo', valor: 16 }, 1)).toBe(16);
    expect(valorCobrado({ tipo: 'fixo', valor: 16 }, 3)).toBe(16);
  });
});

test.describe('lib/precosCiclo — parseValorEuro / valorEuroValido (vírgula e ponto)', () => {
  test('aceita vírgula como separador decimal', () => {
    expect(parseValorEuro('16,00')).toBe(16);
    expect(parseValorEuro('16,5')).toBe(16.5);
  });
  test('aceita ponto como separador decimal', () => {
    expect(parseValorEuro('16.00')).toBe(16);
    expect(parseValorEuro('16.5')).toBe(16.5);
  });
  test('inteiro sem separador é válido', () => {
    expect(parseValorEuro('16')).toBe(16);
  });
  test('campo vazio é null (nunca um erro)', () => {
    expect(parseValorEuro('')).toBeNull();
    expect(parseValorEuro('   ')).toBeNull();
  });
  test('texto não numérico é null', () => {
    expect(parseValorEuro('abc')).toBeNull();
    expect(parseValorEuro('16€')).toBeNull();
  });
  test('mais de 2 casas decimais é null', () => {
    expect(parseValorEuro('16,555')).toBeNull();
  });
  test('valorEuroValido: 0 e 999,99 são válidos; negativo e acima de 999,99 não', () => {
    expect(valorEuroValido(0)).toBe(true);
    expect(valorEuroValido(999.99)).toBe(true);
    expect(valorEuroValido(-0.01)).toBe(false);
    expect(valorEuroValido(1000)).toBe(false);
  });
  test('formatarValorPtPt devolve sempre vírgula e 2 casas', () => {
    expect(formatarValorPtPt(16)).toBe('16,00');
    expect(formatarValorPtPt(16.5)).toBe('16,50');
  });
});

test.describe('lib/precosCiclo — agruparPrecosCiclo', () => {
  const precos: PrecoCiclo[] = [
    { id: '1', ciclo: '1_ciclo', alunosAPartirDe: 1, tipo: 'fixo', valor: 16 },
    { id: '2', ciclo: '2_ciclo', alunosAPartirDe: 1, tipo: 'fixo', valor: 16 },
    { id: '3', ciclo: '2_ciclo', alunosAPartirDe: 2, tipo: 'fixo', valor: 12 },
    { id: '4', ciclo: 'secundario', alunosAPartirDe: 3, tipo: 'fixo', valor: 10 },
  ];
  test('separa individual/grupo por ciclo e os escalões > 2 em "extra"', () => {
    const { porCiclo, extra } = agruparPrecosCiclo(precos);
    expect(porCiclo['1_ciclo'].individual?.valor).toBe(16);
    expect(porCiclo['1_ciclo'].grupo).toBeNull();
    expect(porCiclo['2_ciclo'].individual?.valor).toBe(16);
    expect(porCiclo['2_ciclo'].grupo?.valor).toBe(12);
    expect(porCiclo['3_ciclo'].individual).toBeNull();
    expect(extra).toHaveLength(1);
    expect(extra[0].alunosAPartirDe).toBe(3);
  });
});

test.describe('lib/precosCiclo — validarLinhasCiclo', () => {
  test('texto inválido gera erro no campo certo', () => {
    const erros = validarLinhasCiclo([{ ciclo: '1_ciclo', individual: 'abc', grupo: '' }]);
    expect(erros['1_ciclo']?.individual).toBeTruthy();
  });
  test('valor negativo é inválido', () => {
    const erros = validarLinhasCiclo([{ ciclo: '1_ciclo', individual: '-5', grupo: '' }]);
    expect(erros['1_ciclo']?.individual).toBeTruthy();
  });
  test('valor acima de 999,99 é inválido', () => {
    const erros = validarLinhasCiclo([{ ciclo: '1_ciclo', individual: '1000', grupo: '' }]);
    expect(erros['1_ciclo']?.individual).toBeTruthy();
  });
  test('campos vazios nunca dão erro', () => {
    const erros = validarLinhasCiclo([{ ciclo: '1_ciclo', individual: '', grupo: '' }]);
    expect(erros['1_ciclo']).toBeUndefined();
  });
  test('valores válidos (vírgula ou ponto) nunca dão erro', () => {
    const erros = validarLinhasCiclo([{ ciclo: '2_ciclo', individual: '16,00', grupo: '12.00' }]);
    expect(erros['2_ciclo']).toBeUndefined();
  });
});
