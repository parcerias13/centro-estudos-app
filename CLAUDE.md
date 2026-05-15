# Gestor de Operações — Centros de Estudo (Portugal)

## Visão Geral
Sistema de gestão operacional para centros de estudo em Portugal.
Atualmente em fase de testes num centro real no Porto ("Lígia").
**Objetivo: lançamento no mercado em setembro 2026.**

---

## Stack Técnica

- **Framework:** Next.js (React) com TypeScript (.tsx)
- **Base de Dados / Backend:** Supabase (PostgreSQL + PostgREST)
- **Autenticação:** Supabase Auth
- **Email:** Resend (envio automático de extratos)
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
│   ├── gestao/          # Área restrita a admins (bug conhecido)
│   ├── historico/
│   ├── performance/
│   ├── refeitorio/      # Lançamento de consumos diários
│   ├── relatorio/
│   └── salas/
├── api/
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
- ✅ Autenticação com roles (admin vs aluno/encarregado)
- 🔧 Separador "Gestão" restrito a admins — por vezes bloqueia o próprio admin (bug ativo)

---

## Decisões Arquiteturais

- **Single-Tenant (provisório):** arquitetura fechada no centro da Lígia para validar produto real antes de escalar
- **Lógica de negócio na base de dados:** Views e triggers em PostgreSQL via Supabase
- **Sem backend custom:** toda a API é servida via PostgREST (Supabase)

---

## Roadmap — Por Fazer (Prioridade para Setembro 2026)

### 🔴 Crítico
- [ ] Refactoring para multitenancy
  - Injeção de `centro_id` em todas as tabelas
  - Implementação de RLS (Row Level Security) no Supabase por centro
- [ ] Corrigir bug de autenticação no separador "Gestão" (admin bloqueado)

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
- Supabase client importado de `@/lib/supabase` (verificar path exato)
- Lógica de dados preferencialmente em Server Components ou API Routes do Next.js

---

## Contexto de Negócio

- **Cliente atual:** Centro de estudo "Lígia", Porto
- **Modelo:** SaaS B2B para centros de estudo em Portugal
- **Monetização futura:** mensalidade por centro + fee por transação (Stripe) + LabAI (3€/aluno/mês)
- **RGPD:** dados de menores — privacidade e segurança são prioridade absoluta