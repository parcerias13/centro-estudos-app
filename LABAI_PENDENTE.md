# LabAI — pendente antes de reativar

O módulo LabAI está desativado (`lib/features.ts`, `LAB_AI_ATIVO = false`). Ninguém — aluno, professor ou admin — tem acesso: `app/api/lab/route.ts` devolve `503` para qualquer pedido antes de tocar em qualquer coisa, a página `app/aluno/lab` só redireciona para `/`, o middleware bloqueia `/aluno/lab` e subcaminhos para todos os papéis, e os cartões de entrada em `app/page.tsx` ficam escondidos mesmo com `consentimento_ia = true`.

Reativar é mudar `LAB_AI_ATIVO` para `true` — mas só depois de resolver o que está aqui.

## O que há a resolver antes de reativar

1. **Rota sem sessão.** `app/api/lab/route.ts` nunca verificou login, role nem centro — era chamável por qualquer pessoa na internet, sem exceção.
2. **`alunoId` vem do corpo do pedido.** Nada liga o `alunoId` à sessão de quem chama — qualquer pessoa pode gastar o crédito de IA (0,40€/mês) de qualquer aluno com `consentimento_ia = true`, sem ser esse aluno.
3. **SSRF via `fileUrl`.** A rota faz `fetch(fileUrl)` no servidor com o que vier no pedido, sem validar o domínio/host. Um URL apontando para um serviço interno (ou qualquer host arbitrário) é pedido pelo próprio servidor.
4. **Sem rate limit por utilizador/IP.** Só há um "espera 30s entre uploads de PDF" por aluno — nada impede chamadas em massa ao endpoint de chat (que custa por token da OpenAI) a partir de várias contas ou sem conta nenhuma (ver ponto 1).
5. **`error.message` cru.** O catch genérico (`console.error` + mensagem fixa) está bem; mas vale confirmar que nenhum erro interno (ex: da OpenAI, do Supabase) chega a escapar para o cliente em nenhum ramo, ao rever a rota de novo.
6. **Bucket `lab_pdfs` é público.** PDFs que alunos enviam (potencialmente com conteúdo pessoal/escolar) ficam num bucket com `getPublicUrl` acessível a qualquer pessoa com o caminho — nunca houve `createSignedUrl`. Vale decidir se este bucket devia passar a privado como o `mensagens-anexos`.
7. **Bucket `lab_privado` existe e não é usado por nada.** Criado a pensar no LabAI, mas o código nunca lhe chama. Ou se usa para o que for a nova versão do LabAI, ou remove-se.

## SQL de Storage removido agora, a recriar ao reativar

Esta política (INSERT do aluno em `lab_pdfs`, restrita à pasta do seu centro) foi removida como parte da desativação. Recriar exatamente esta forma — ou uma versão já corrigida que resolva os pontos 3 e 6 acima — antes de voltar a ligar `LAB_AI_ATIVO`:

```sql
create policy storage_aluno_lab_pdfs_por_centro on storage.objects
for insert to authenticated
with check (
  bucket_id = 'lab_pdfs'
  and (storage.foldername(name))[1] = get_centro_id()::text
);
```

## O que NÃO foi tocado

- Os campos e formulários de `consentimento_ia` em `app/admin/alunos/novo` e `app/admin/alunos/editar` continuam exatamente como estavam — são dados do aluno, não pontos de entrada ao Lab.
- A coluna `consentimento_ia`, `creditos_usados`, `ultimo_pdf_texto`, `ultimo_upload` em `alunos` não foram alteradas.
- O código da UI de chat em `app/aluno/lab/page.tsx` foi substituído por um redirecionamento simples; se for para recuperar a interface ao reativar, está no histórico do git antes deste commit.
