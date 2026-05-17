# AGENT.md — CogniLab

Instruções para o Claude Code trabalhar neste projeto.
Lê este ficheiro inteiro antes de fazer qualquer alteração.

---

## O que é este projeto

**CogniLab** — SaaS de gestão para centros de estudo em Portugal.
- Cliente atual: centro "Lígia" (Porto)
- Objetivo: lançamento no mercado em setembro 2026
- Stack: Next.js 14 + TypeScript + Supabase (PostgreSQL + PostgREST)

---

## Stack Técnica

- **Framework:** Next.js com TypeScript — todos os ficheiros são `.tsx` ou `.ts`
- **Base de dados:** Supabase (PostgreSQL). O Supabase corre separado no browser — nunca tens acesso direto à DB
- **Auth:** Supabase Auth com roles via `app_metadata` (`role` + `centro_id`)
- **Email:** Resend (apenas server-side, via API Routes)
- **Linting:** Biome-JS

---

## Regras Absolutas

1. **Nunca alteras a base de dados.** Se for necessário SQL, escreves o script e dizes ao utilizador para o correr manualmente no Supabase dashboard.
2. **Nunca fazes deploy.** Qualquer referência a deploy é para o utilizador decidir.
3. **Nunca apagues ficheiros** sem perguntar explicitamente primeiro.
4. **TypeScript obrigatório** — sem `any` sem justificação, sem `.js` ou `.jsx`.
5. **Não quebrares o que está a funcionar.** Se uma alteração afeta múltiplos ficheiros, avisa antes de avançar.

---

## Antes de Alterar Múltiplos Ficheiros

Se uma tarefa implica alterar mais do que 3 ficheiros, **para e pergunta** antes de avançar:
- Lista os ficheiros que vais alterar
- Explica o que vais fazer em cada um
- Aguarda confirmação

---

## Convenções de Código

- Componentes em **PascalCase** (`AlunoCard.tsx`)
- Funções utilitárias em **camelCase** (`formatarData.ts`)
- Supabase client importado de `@/lib/supabase` (cliente público, browser)
- Supabase admin (service role) **nunca** no browser — só em API Routes (`/app/api/`)
- Lógica de dados preferencialmente em Server Components ou API Routes
- Sem `console.log` de debug no código final

---

## Multitenancy — Contexto Crítico

Todas as tabelas têm `centro_id` (UUID). O RLS (Row Level Security) está ativo no Supabase — cada utilizador só vê dados do seu centro via JWT `app_metadata`.

- **Nunca** inseres dados sem `centro_id`
- **Nunca** fazes queries que ignorem o isolamento por centro
- O `centro_id` da Lígia (cliente de testes) é: `c28909c4-f4e5-4cda-82de-a2ecb8e7063d`

---

## Estrutura de Pastas Relevante

```
app/
├── admin/          # Área de administração (role: admin)
│   ├── alunos/
│   ├── gestao/     # Restrito a admins
│   ├── refeitorio/
│   └── ...
├── api/            # API Routes (server-side apenas)
│   ├── lab/        # Módulo LabAI (em desenvolvimento)
│   └── send-report/
├── aluno/          # Área do aluno/encarregado
└── ...
lib/
├── supabase.ts     # Cliente público (anon key, browser)
└── supabaseAdmin.ts # Cliente admin (service role, server apenas)
```

---

## RGPD — Dados de Menores

Este sistema contém dados de crianças e adolescentes. Em qualquer feature nova:
- Nunca expões dados de alunos desnecessariamente
- Sem logs de dados pessoais
- Sem envio de dados para serviços externos sem necessidade explícita

---

## Bugs Conhecidos / Estado Atual

- Hydration mismatch no browser — causado por extensões do browser, não é bug do código
- Módulo LabAI (`/api/lab`) está em desenvolvimento — não alteres sem instrução explícita

---

## Como Reportar o que Fizeste

No final de cada tarefa, lista sempre:
1. Ficheiros alterados (com path completo)
2. O que foi feito em cada um
3. Se há SQL para correr manualmente
4. Se há variáveis de ambiente novas a adicionar ao `.env.local`