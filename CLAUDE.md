# Gestor de Operações — Centros de Estudo (Portugal)

## Visão Geral
Sistema de gestão operacional para centros de estudo em Portugal.
Marca: **CogniLab**.
Atualmente em fase de testes num centro real no Porto ("Lígia").
**Objetivo: lançamento no mercado em setembro 2026.**

---

## Stack Técnica

- **Framework:** Next.js (React) com TypeScript (.tsx)
- **Base de Dados / Backend:** Supabase (PostgreSQL + PostgREST)
- **Autenticação:** Supabase Auth (roles via JWT `app_metadata`)
- **Email:** Resend (envio automático de extratos) — API key exclusivamente server-side
- **Ambiente:** VS Code + Claude Code
- **Deploy:** (a definir)

---

## Estrutura de Pastas

```
app/
├── admin/
│   ├── agenda/
│   ├── alunos/          # Gestão de fichas e perfis de alunos
│   │   ├── editar/
│   │   ├── extrato/
│   │   └── novo/
│   ├── biblioteca/
│   ├── disciplinas/
│   ├── equipa/
│   ├── gestao/          # Área restrita a admins (bug resolvido em 2026-05-15)
│   ├── historico/
│   ├── performance/
│   ├── refeitorio/      # Lançamento de consumos diários
│   ├── relatorio/
│   └── salas/
├── api/
│   ├── config-centro/   # API route para configuração do centro (usa service role)
│   ├── lab/             # Módulo LabAI (em desenvolvimento)
│   └── send-report/     # Envio de extratos por email
├── agenda/
├── aluno/               # Área do aluno
├── biblioteca/
├── login/
└── perfil/
```

---

## Funcionalidades Implementadas (MVP "Lígia")

- ✅ Gestão de perfis de alunos (fichas completas, alocação a turmas/ciclos)
- ✅ Views SQL dinâmicas (`alunos_com_ciclo`) para categorização por ano escolar
- ✅ Modelo de mensalidade fixa (`mensalidade_base`)
- ✅ Registo de presenças (check-in / check-out digital)
- ✅ Geração e envio automático de extratos mensais por email (Resend)
- ✅ Gestão de extras (lanches, transportes, refeições) que acumulam no extrato
- ✅ Autenticação com roles (admin vs aluno/encarregado) — verificação server-side via JWT
- ✅ Separador "Gestão" funcional e protegido (bug resolvido — service role + JWT app_metadata)
- ✅ Supabase client unificado como singleton em toda a aplicação (`@/lib/supabase`)
- ✅ Soft-delete removido completamente — deleção direta sem `deleted_at`
- ✅ Diário de bordo com coluna unificada `aluno_id` (sem duplicação com `student_id`)
- ✅ Refeitório com filtro de alunos presentes alinhado com o dashboard

---

## Trabalho Recente

### 2026-05-16 (hoje)
- Refeitório: filtro de alunos presentes corrigido para usar a mesma lógica do dashboard
- `diario_bordo`: substituição de `student_id` por `aluno_id` nas queries da página de alunos
- Supabase client unificado como singleton em 19 ficheiros (eliminou 107 linhas de código duplicado)

### 2026-05-15
- Bug "Gestão" resolvido: verificação de role admin movida para server-side via JWT `app_metadata`
- Middleware de autenticação corrigido para ler role do JWT (sem chamada extra à base de dados)
- API key do Resend movida para API Route server-side (segurança)
- `centro_id` da Lígia corrigido na página de Gestão e na `api/config-centro`
- Soft-delete (`deleted_at`) removido completamente do código e da base de dados
- Marca unificada para "CogniLab" em `app/layout.tsx` e `app/admin/layout.tsx`
- `student_id` duplicado removido do `diario_bordo` — mantido apenas `aluno_id`
- Primeira passagem de unificação do Supabase client singleton (ficheiros admin core)

---

## Estado do Multitenancy (2026-05-16)

### ✅ Já feito
- `centro_id` presente na tabela de centros e referenciado na lógica de gestão (Lígia)
- Supabase client como singleton — base limpa para injetar contexto de tenant
- Verificação de admin server-side — pronta para ser parametrizada por centro

### 🔴 Por fazer — Crítico para setembro 2026
- [ ] Adicionar `centro_id` a **todas as tabelas** (alunos, presenças, extras, diario_bordo, etc.)
- [ ] Implementar RLS (Row Level Security) no Supabase por `centro_id`
- [ ] Injetar `centro_id` do utilizador autenticado em todas as queries (sem hardcode)
- [ ] Criar mecanismo de onboarding para novos centros (registo + configuração inicial)
- [ ] Testes com dois centros em simultâneo para validar isolamento de dados

---

## Decisões Arquiteturais

- **Single-Tenant (provisório):** arquitetura fechada no centro da Lígia para validar produto real antes de escalar
- **Lógica de negócio na base de dados:** Views e triggers em PostgreSQL via Supabase
- **Sem backend custom:** toda a API é servida via PostgREST (Supabase)
- **Sem soft-delete:** deleção é permanente — simplifica queries e evita dados "fantasma"
- **Supabase client singleton:** importar sempre de `@/lib/supabase`, nunca criar instâncias locais

---

## Roadmap — Por Fazer (Prioridade para Setembro 2026)

### 🔴 Crítico
- [ ] Refactoring completo para multitenancy (ver secção acima)
- [ ] RLS por `centro_id` em todas as tabelas do Supabase

### 🟡 Alta Prioridade
- [ ] Motor financeiro com Stripe (pagamento direto pelos extratos)
- [ ] Integração com APIs de faturação certificadas (InvoiceXpress ou Primavera)
- [ ] Landing page comercial (conversão + agendamento de demos)

### 🟢 Médio Prazo
- [ ] Módulo LabAI (tutor de IA por aluno — modelo B2B2C, 3€/aluno/mês)
- [ ] TDD automático para todo o código novo
- [ ] PRDs formais para cada feature antes de implementar

---

## Convenções de Código

- TypeScript obrigatório em todos os ficheiros (.tsx / .ts)
- Componentes em PascalCase
- **Supabase client:** importar sempre o singleton de `@/lib/supabase` — nunca chamar `createBrowserClient` diretamente
- Lógica de dados preferencialmente em Server Components ou API Routes do Next.js
- Verificações de autenticação/autorização sempre server-side (JWT `app_metadata`)
- Sem soft-delete: usar deleção direta

---

## Contexto de Negócio

- **Marca:** CogniLab
- **Cliente atual:** Centro de estudo "Lígia", Porto
- **Modelo:** SaaS B2B para centros de estudo em Portugal
- **Monetização futura:** mensalidade por centro + fee por transação (Stripe) + LabAI (3€/aluno/mês)
- **RGPD:** dados de menores — privacidade e segurança são prioridade absoluta
