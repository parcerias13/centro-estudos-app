import { test, expect } from '@playwright/test';
import {
  valorNoMes,
  estadoCustoFixoNoMes,
  calcularCustosDoMes,
  listaDeMeses,
  somarMeses,
  mesParaIndice,
  indiceParaMes,
  ultimoDiaDoMes,
  mesParaData,
  mensagemErroCusto,
  type PeriodoCustoFixo,
  type CustoFixoComPeriodos,
  type DespesaVariavel,
} from '@/lib/custos';

// Testes de lógica pura de lib/custos.ts — sem Supabase, sem browser. Mesma
// função usada por Gestão (ecrã "Custos") e Performance; se estes passarem,
// os dois ecrãs nunca podem divergir para os mesmos dados.

test.describe('lib/custos — aritmética de meses (sem Date)', () => {
  test('mesParaIndice/indiceParaMes são inversas', () => {
    for (const mes of ['2026-01', '2026-12', '2025-06', '2030-03']) {
      expect(indiceParaMes(mesParaIndice(mes))).toBe(mes);
    }
  });

  test('somarMeses atravessa a virada de ano nos dois sentidos', () => {
    expect(somarMeses('2026-01', -1)).toBe('2025-12');
    expect(somarMeses('2025-12', 1)).toBe('2026-01');
    expect(somarMeses('2026-06', 6)).toBe('2026-12');
    expect(somarMeses('2026-06', -6)).toBe('2025-12');
  });

  test('ultimoDiaDoMes acerta fevereiro em ano bissexto e não bissexto', () => {
    expect(ultimoDiaDoMes('2026-02')).toBe('2026-02-28'); // 2026 não é bissexto
    expect(ultimoDiaDoMes('2024-02')).toBe('2024-02-29'); // 2024 é bissexto
    expect(ultimoDiaDoMes('2026-04')).toBe('2026-04-30');
    expect(ultimoDiaDoMes('2026-01')).toBe('2026-01-31');
  });

  test('mesParaData devolve o 1.º dia do mês', () => {
    expect(mesParaData('2026-03')).toBe('2026-03-01');
  });
});

test.describe('lib/custos — valorNoMes / estadoCustoFixoNoMes', () => {
  test('a renda de 600€ que passa a 650€ em janeiro: dezembro mantém 600', () => {
    const periodos: PeriodoCustoFixo[] = [
      { de: '2025-06-01', ate: '2025-12-01', valor: 600 },
      { de: '2026-01-01', ate: null, valor: 650 },
    ];
    expect(valorNoMes(periodos, '2025-12')).toBe(600);
    expect(valorNoMes(periodos, '2026-01')).toBe(650);
    expect(valorNoMes(periodos, '2026-02')).toBe(650);
    expect(estadoCustoFixoNoMes(periodos, '2025-12')).toEqual({ estado: 'ativo', valor: 600 });
    expect(estadoCustoFixoNoMes(periodos, '2026-01')).toEqual({ estado: 'ativo', valor: 650 });
  });

  test('um custo terminado deixa de contar depois do fim e continua a contar antes', () => {
    const periodos: PeriodoCustoFixo[] = [{ de: '2026-01-01', ate: '2026-06-01', valor: 100 }];
    expect(valorNoMes(periodos, '2026-05')).toBe(100);
    expect(valorNoMes(periodos, '2026-06')).toBe(100); // mês de término ainda conta (inclusivo)
    expect(valorNoMes(periodos, '2026-07')).toBeNull();
    expect(estadoCustoFixoNoMes(periodos, '2026-07')).toEqual({ estado: 'terminado', valor: null, terminouEm: '2026-06' });
    expect(estadoCustoFixoNoMes(periodos, '2026-03')).toEqual({ estado: 'ativo', valor: 100 });
  });

  test('um custo que começa a meio da história', () => {
    const periodos: PeriodoCustoFixo[] = [{ de: '2026-05-01', ate: null, valor: 50 }];
    expect(estadoCustoFixoNoMes(periodos, '2026-01')).toEqual({ estado: 'nao_comecou', valor: null });
    expect(estadoCustoFixoNoMes(periodos, '2026-04')).toEqual({ estado: 'nao_comecou', valor: null });
    expect(estadoCustoFixoNoMes(periodos, '2026-05')).toEqual({ estado: 'ativo', valor: 50 });
    expect(estadoCustoFixoNoMes(periodos, '2026-06')).toEqual({ estado: 'ativo', valor: 50 });
  });

  test('um custo sem nenhum período ainda não começou', () => {
    expect(estadoCustoFixoNoMes([], '2026-01')).toEqual({ estado: 'nao_comecou', valor: null });
  });
});

test.describe('lib/custos — calcularCustosDoMes (totais)', () => {
  const fixos: CustoFixoComPeriodos[] = [
    {
      id: 'f1',
      nome: 'Renda',
      categoria: 'Outros',
      periodos: [
        { de: '2025-06-01', ate: '2025-12-01', valor: 600 },
        { de: '2026-01-01', ate: null, valor: 650 },
      ],
    },
    {
      id: 'f2',
      nome: 'Salário Professores',
      categoria: 'Professores',
      periodos: [{ de: '2026-01-01', ate: '2026-03-01', valor: 1200 }],
    },
  ];

  test('um mês sem nada dá tudo a zero', () => {
    const resultado = calcularCustosDoMes([], [], '2026-01');
    expect(resultado).toEqual({ fixos: [], variaveis: [], totalFixos: 0, totalVariaveis: 0, totalGeral: 0 });
  });

  test('totais de um mês com fixos e variáveis', () => {
    const variaveis: DespesaVariavel[] = [
      { id: 'v1', categoria: 'Materiais', descricao: 'Resmas', valor: 30, data: '2026-01-10' },
      { id: 'v2', categoria: 'Comida', descricao: null, valor: 20, data: '2026-01-20' },
    ];
    const resultado = calcularCustosDoMes(fixos, variaveis, '2026-01');
    // Renda (650, já mudou) + Salário Professores (1200, ainda ativo em janeiro) = 1850
    expect(resultado.totalFixos).toBe(1850);
    expect(resultado.totalVariaveis).toBe(50);
    expect(resultado.totalGeral).toBe(1900);
    expect(resultado.fixos).toHaveLength(2);
    expect(resultado.fixos.find((f) => f.id === 'f1')?.valor).toBe(650);
  });

  test('num mês depois do fim do Salário Professores, só a Renda conta', () => {
    const resultado = calcularCustosDoMes(fixos, [], '2026-04');
    expect(resultado.totalFixos).toBe(650);
    const salario = resultado.fixos.find((f) => f.id === 'f2');
    expect(salario?.estado).toBe('terminado');
    expect(salario?.terminouEm).toBe('2026-03');
  });
});

test.describe('lib/custos — listaDeMeses', () => {
  test('sem dados nenhuns, mostra os últimos 12 meses até ao atual', () => {
    const meses = listaDeMeses([], '2026-10');
    expect(meses).toHaveLength(12);
    expect(meses[0]).toBe('2025-11');
    expect(meses[meses.length - 1]).toBe('2026-10');
  });

  test('com dados recentes, começa no mês mais antigo com dados (não em 12 meses atrás)', () => {
    const meses = listaDeMeses(['2026-08', '2026-09'], '2026-10');
    expect(meses).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  test('com dados mais antigos que 12 meses, nunca recua mais do que o limite', () => {
    const meses = listaDeMeses(['2020-01'], '2026-10');
    expect(meses[0]).toBe('2025-11');
    expect(meses).toHaveLength(12);
  });
});

test.describe('lib/custos — mensagemErroCusto', () => {
  test('23P01 vira mensagem simples', () => {
    expect(mensagemErroCusto({ code: '23P01', message: 'exclusion constraint violated' })).toBe('Já existe um valor para esse mês.');
  });
  test('outros códigos devolvem a mensagem original', () => {
    expect(mensagemErroCusto({ code: '23514', message: 'valor inválido' })).toBe('valor inválido');
  });
});
