# StudyCloud — Gestor de Operações para Centros de Estudo (Portugal)

SaaS multi-centro para centros de estudo em Portugal, construído a solo por Luís. O produto chama-se **StudyCloud** (nome antigo: CogniLab). Produção: https://app.studycloud.pt. Repositório: GitHub parcerias13/centro-estudos-app.

> Este ficheiro é lido no início de cada conversa. Mantém-no curto e factual. Se o código contradisser o que está aqui, **pára e pergunta**: o código manda, e este ficheiro deve ser corrigido.

---

## Centros (nunca misturar)

| Centro | Papel | Regra |
|---|---|---|
| **Trupe Lias** (`1ea25b5c-3838-46d9-b434-717472526211`) | Centro REAL, em uso | NUNCA testar contra ele. NUNCA apagar nem alterar dados dele sem ordem explícita do Luís. |
| **Centro teste** (`c28909c4-f4e5-4cda-82de-a2ecb8e7063d`) | Antigo piloto «Lígia»; hoje centro de ensaio manual do Luís (admin@centro.pt) | Não corras testes automáticos contra ele. |
| **CogniLab Demo** (`becb7828-d59c-4ab9-8469-39ac552e378d`) | Centro de avaliação externa, BLOQUEADO de propósito (`banned_until`) | NUNCA tentes entrar nas contas dele. `tests/permissoes-professor.spec.ts` depende dele e fica FORA das corridas completas. |
| **ZZTESTE …** | Centros descartáveis criados pelos testes (`novo-centro.mjs`) e apagados no fim (`apagar-centro.mjs`) | Os testes só mexem nestes. `apagar-centro.mjs` recusa qualquer nome que não comece por «ZZTESTE». |
| «Teste Admin Chamador/Alvo …» | Restos de testes antigos | Não apagar sem ordem do Luís. |

## Regras de segurança (obrigatórias)

- **Credenciais:** nunca ler, mostrar, copiar, redigir nem processar com `sed`, `grep` ou regex ficheiros de credenciais (`credenciais*.txt`, `.env*`, `ids.json`, chaves, tokens, palavras-passe). Para sessões de teste, usa os scripts autorizados (`~/Desktop/gestao-centros/*.mjs`, para os centros ZZTESTE; `~/Desktop/demo-centro/entrar.mjs`, para o centro Demo), que leem as credenciais sem as mostrar; se faltar uma conta, pede a palavra-passe ao utilizador ou cria uma conta temporária por script em vez de ler o ficheiro.
- **Dados de menores (RGPD):** privacidade e segurança são prioridade absoluta.
- **Base de dados:** NÃO alteres RLS, gatilhos, funções nem buckets sem ordem explícita. O SQL é escrito e aplicado pelo Luís (no Supabase). Se uma tarefa precisar de SQL novo, **pára e diz-o**.
- **Nunca** apagues contas de autenticação nem centros fora de um ZZTESTE criado por ti.
- **Operações privilegiadas** (criar utilizadores, repor palavras-passe, configuração do centro…) só em rotas `app/api/**` com a chave de serviço, nunca no browser. Nunca expor a chave de serviço nem a do Resend ao cliente.

## Como trabalhamos

- Investigar → mostrar o que encontraste → confirmar → aplicar → testar → commit e push direto para `main` (sem PRs).
- **Só fazes commit quando o Luís manda**, só dos ficheiros esperados (`git status --short` primeiro; se aparecer qualquer outro, pára). Um só `git push origin main`; se falhar com «fatal error in commit_refs_rules», espera 2 minutos e repete no máximo duas vezes; **nunca `--force`**.
- Um passo de cada vez, com validação. Decisões de negócio: apresenta análise e opinião, mas a decisão é sempre do Luís.
- Antes de SQL no Supabase o Luís faz backup (`cd ~/StudyCloud-backups && node backup.mjs`).
- O bloco entre `<!-- BEGIN:nextjs-agent-rules -->` e `<!-- END:nextjs-agent-rules -->` no fim deste ficheiro é gerado pelo `next dev`: não o edites à mão.

## Stack

Next.js (App Router) + TypeScript · Supabase (PostgreSQL + PostgREST + RLS + Auth + Storage + pg_cron) · Resend (email, DESLIGADO por agora) · Vercel (deploy automático a cada push para `main`) · Tailwind v4 · date-fns · lucide-react · Playwright. Ambiente: VS Code + Claude Code. Localhost e produção **partilham a mesma base de dados** (os dados não passam pelo git; o código só chega à produção depois do push).

## Mapa da aplicação (resumo; confirma no código)

- **Staff** (`app/admin/**`): Dashboard (presenças ao vivo, «Lista do Dia», «Turno de Hoje» do professor), alunos, equipa (+ horas de trabalho e remuneração), horas, gestão (custos, despesas, serviços, preços das explicações por ciclo, modo de presenças, cancelamento pelo aluno), pagamentos, performance, explicações (+ fixas, fixas por validar), os-meus-alunos (professor), agenda, notas, mensagens, alterações, histórico, refeitório, salas, relatório do aluno, perfil, disciplinas.
- **Aluno** (conta partilhada com a família): início (check-in e cartões), agenda (testes em calendário), minhas-explicações (ver e cancelar), material, notas, biblioteca, e a **Área dos Encarregados** (`app/encarregados/**`, atrás de um código de 4 dígitos): Resumo do Mês, mensagens, palavra-passe.
- **API** (`app/api/**`): rotas com chave de serviço (criar aluno/staff, repor palavra-passe, config do centro, modo de presenças, alterar palavra-passe…).
- **Menus por cargo:** `middleware.ts` (`ROLE_ALLOWED_PATHS`) e `app/admin/layout.tsx` (`ROLE_ALLOWED_MENU`). O admin tem acesso total a `/admin/*`; esconde-se itens do menu, não se bloqueiam rotas ao admin. O `middleware.ts` está marcado como obsoleto pelo Next (migrar para `proxy` é dívida conhecida).

## Base de dados — convenções

- `centro_id` em todas as tabelas com âmbito de centro, com **RLS** por `centro_id = get_centro_id()` (função que lê o `centro_id` do JWT). O JWT leva `role` e `centro_id` em `app_metadata`. Cargos: `admin`, `professor`, `secretaria`, `aluno`.
- Todo o insert inclui `centro_id`, lido de `supabase.auth.getUser()` → `user.app_metadata.centro_id`, com guard se vier em falta.
- A lógica de dinheiro e de regras vive em **SQL** (gatilhos e RPCs `SECURITY DEFINER`), não no cliente: preço por ciclo e grupo (`calcular_valores_explicacao`), registo de horas dos professores, fecho das 22:00 UTC (`checkout_em_massa`, pg_cron), criação das mensalidades no dia 1 (`gerar_mensalidades_do_mes`, pg_cron), `resumo_mes_encarregado`, `minhas_explicacoes`, `cancelar_explicacao_aluno`, etc.
- **Explicações:** sessões (`explicacoes` + `explicacoes_alunos`) e fixas (`series_explicacoes*`). Restrição `explicacoes_serie_coerente`: `serie_id` e `data_serie` ou estão os dois preenchidos ou os dois nulos; índice único por (`serie_id`, `data_serie`). O cancelamento tardio pelo aluno passa a sessão a «dada» (conta como qualquer outra).
- **Notas:** `exams` e `notas_periodo` têm gatilhos que impedem o aluno de forjar confirmações; só se mostra a nota se estiver confirmada.
- **Pagamentos:** manuais, sem gateway (sem Stripe). Mensalidade = linha do mês em `mensalidades` (nunca a `mensalidade_base` da ficha, que só serve de base às presenças). As explicações pagam-se em `pagamentos_explicacoes_familia`. Os extras somam-se ao extrato. Faturação certificada fica fora da app (exporta-se Excel).
- `supabase-schema.sql` e `supabase-rls.sql` estão **desatualizados**: não confies neles. Confirma colunas e regras por introspeção no Supabase.

## Convenções de código

- TypeScript obrigatório; componentes em PascalCase; sem `console.log` de debug no código final.
- **Datas e horas:** NUNCA `new Date()` nem `toISOString()` para decidir o dia, o mês ou a hora. Usa `getHojeLisboa()`, `dataLisboaDe()` e `horaLisboaDe()` de `lib/dataLisboa.ts` (fuso Europe/Lisbon).
- **Erros sempre visíveis:** `useStatusToast` / `StatusToast` (`lib/statusToast`), nunca `alert()` nem falhas silenciosas.
- **UI:** ícones `lucide-react` (sem emojis); Sora nos títulos e Inter no corpo; mobile primeiro (360–430 px sem scroll horizontal, alvos de toque de 44 px).
- **Tailwind v4:** o nome de um token de cor NÃO pode incluir o prefixo do utilitário (`--color-page`, nunca `--color-bg-page`), senão a classe não é gerada e o CSS falha em silêncio. `success`, `danger` e `warning` são só para estados semânticos, nunca para decoração.

## Testes (Playwright)

- Só em centros **ZZTESTE** criados por `~/Desktop/gestao-centros/novo-centro.mjs`, com sessões reais; chave de serviço só para preparar e verificar; no fim apagar com `apagar-centro.mjs` e confirmar que não resta nada.
- **Nunca** contra o Trupe Lias; **nunca** entrar no centro Demo; excluir `tests/permissoes-professor.spec.ts` das corridas completas.
- **Modo económico:** ao depurar, só os specs afetados; a suite completa UMA vez no fim, com `--workers=2`.
- **Os testes não podem depender da hora do dia nem do dia do mês:** calcula instantes relativos a «agora» e ao dia de Lisboa, e usa `test.skip` com a razão escrita quando um cenário ficaria instável junto de uma fronteira. Evita correr a suite de madrugada.
- Sessões de fixas inseridas à mão: preenche `serie_id` E `data_serie`.
- Falhas conhecidas de infraestrutura: timeouts de `tests/mensalidades-geracao.spec.ts` e de limpeza (`afterAll`) por contenção. Confirma sempre isolado antes de concluir que é regressão.

## Estado do negócio

- Preços (por centro): 79 €/mês até 40 alunos, 119 € até 80, 149 € acima; desconto de fundador de 40% vitalício para os primeiros 3 a 5 centros. Sem Stripe nem gateway: os centros recebem por MB Way ou transferência, e a app só dá visibilidade (pago ou não, por aluno e mês).
- Email desligado: os avisos às famílias existem só dentro da app (mensagens). Um email mensal de lembrete fica previsto para quando houver `suporte@studycloud.pt` e Resend.
- Onboarding de novos centros é manual (`novo-centro.mjs` + Supabase); não há fluxo de produto.

## Dívida técnica conhecida

- Todo o staff lê a ficha de todos os alunos do centro (incluindo mensalidade) e a tabela `staff` (incluindo tarifas dos colegas).
- `middleware.ts` obsoleto (Next pede `proxy`). `confirm()` nativos ainda existem em alguns ecrãs.
- Testes que dependem da hora do dia; limpeza dos testes frágil; contas de autenticação órfãs de testes por limpar.
- Aviso por email e notificações não existem: o professor e as famílias só veem os avisos dentro da app.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
