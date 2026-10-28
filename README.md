# DOXIS v3

Portal de PDFs de colaboradores. O administrador cadastra, edita, ativa/desativa colaboradores, redefine senhas e envia um PDF ou um lote ao mesmo destinatário. O colaborador consulta, visualiza e baixa os próprios documentos.

## Estado desta implementação

O frontend usa Supabase Auth, tabelas `doxis_*` e a Edge Function `doxis-admin`. O perfil salvo pela versão antiga em `doxis_s` é descartado. Nenhuma senha é armazenada nas tabelas do aplicativo. O login continua sendo CPF e senha; internamente, Auth utiliza o identificador técnico `<CPF>@cpf.doxis.invalid`, sem envio de email.

**Publicar somente o HTML não ativa a v3.** É necessário aplicar a migração, implantar a função e preparar as contas. A migração é aditiva: não altera nem importa `profiles`, `documents`, RPCs ou PDFs antigos. As contas e documentos antigos não aparecem automaticamente na nova interface.

## Desenvolvimento e verificações

Requer Node.js 22 ou superior, sem instalação de pacotes para os testes unitários:

```sh
npm run check
npm test
python -m http.server 8000
```

Abra `http://localhost:8000`. O servidor estático não substitui o backend. Para desenvolvimento isolado, use um projeto Supabase de homologação ou a CLI do Supabase. Nunca execute os testes SQL em produção.

Arquivos principais:

- `index.html`: apresentação e estilos.
- `app.js`: telas, sessão autenticada, consultas e ações.
- `security.js`: validação compartilhada de CPF/PDF e escape de HTML.
- `config.js`: URL-base do projeto e chave pública `anon` (nunca `service_role`).
- `supabase/migrations/`: esquema, restrições, políticas RLS e operações transacionais.
- `supabase/functions/doxis-admin/`: autorização, validação do arquivo no servidor, operações administrativas, links assinados e auditoria.
- `tests/`: testes automatizados e roteiro SQL de isolamento.

## Implantação em homologação

1. Faça backup do banco e dos arquivos atuais. Use primeiro um projeto de homologação. Mantenha o frontend antigo disponível para reversão até concluir a migração dos dados.
2. No Supabase Auth, habilite login com email/senha e **desabilite cadastro público**. Os colaboradores são criados somente pela função administrativa. Configure limites de tentativas no Auth e duração dos JWTs conforme a operação.
3. Em `config.js`, use a URL-base `https://<projeto>.supabase.co` e a chave pública do mesmo projeto. Não acrescente `/rest/v1/`. A configuração fornecida aponta ao projeto que já constava no código original; troque-a para homologação antes dos testes manuais.
4. Aplique `supabase/migrations/202610280001_doxis_v3.sql` no banco de homologação. Pela CLI, vincule explicitamente o projeto correto e use `supabase db push`; ou execute a migração no SQL Editor. A migração cria recursos novos e deve ser aplicada uma única vez, pelo controle de migrações.
5. Configure `DOXIS_ALLOWED_ORIGINS` com as origens exatas que servirão o frontend, sem barra final, separadas por vírgula. Exemplo: `https://seu-portal.example,http://localhost:8000`. Defina o segredo pela CLI ou pelo painel de Edge Functions. Em produção remova localhost. `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` devem existir no ambiente da função; o Supabase hospedado fornece essas variáveis. Não copie a chave de serviço para `config.js`, para o HTML ou para commits.
6. Implante: `supabase functions deploy doxis-admin`. O `verify_jwt = false` em `config.toml` delega a validação ao handler, que chama `auth.getUser(token)` **antes de toda ação**, verifica perfil ativo, papel, troca obrigatória e o limite de revogação. Nenhuma ação sem autenticação é aceita.
7. Crie o primeiro administrador no painel **Authentication → Users**, com email técnico `<CPF válido>@cpf.doxis.invalid`, senha inicial forte e email confirmado. Depois insira o perfil correspondente pelo SQL Editor:

```sql
-- Substitua o CPF e o nome antes de executar. Use o mesmo CPF no email do Auth.
insert into public.doxis_profiles (id,cpf,name,role,must_change_password)
select id, '52998224725', 'Administrador', 'admin', true
from auth.users
where email = '52998224725@cpf.doxis.invalid';
```

8. Entre com CPF e senha inicial e altere a senha. Refaça o login após a troca. Cadastre dois colaboradores de teste e conclua o roteiro de aceite abaixo antes de disponibilizar a aplicação.

## Acesso e arquivos

- A identidade vem do JWT validado pelo Auth; CPF, papel e autor enviados pelo navegador não concedem acesso.
- RLS restringe metadados ao proprietário ou administrador ativo com senha já alterada. As tabelas não aceitam escrita direta de clientes. Contas desativadas, com troca obrigatória ou JWT anterior à redefinição não podem consultar documentos.
- PDFs ficam no bucket privado **`doxis-v3-documentos`**. Uma política restritiva impede acesso direto a esse bucket mesmo se houver políticas permissivas antigas em `storage.objects`. Apenas a função de servidor, usando a chave de serviço, opera os objetos.
- Visualização e download recebem URLs assinadas de 5 minutos. Uma URL já emitida pode continuar válida até expirar, inclusive após logout ou desativação. O botão de download usa a disposição de conteúdo do Storage, sem depender do atributo HTML `download` entre origens.
- Senhas iniciais e redefinidas exigem troca. Alterações de senha/desativação invalidam JWTs antigos para os novos recursos por `session_not_before`. Aguarde o próximo segundo para um novo login imediatamente após uma troca; a comparação usa o `iat` em segundos do JWT.
- A sessão persistente é administrada pelo SDK do Supabase no navegador. Esta versão não implementa cookies HttpOnly; isso exigiria um backend que também servisse a sessão web. Dados de exibição são escapados e não entram em handlers de eventos.
- A validação verifica extensão, MIME, tamanho de até 50 MiB e assinatura `%PDF-` no cliente e no servidor. Isso não equivale à análise estrutural completa do PDF ou a antivírus.

## Consistência e recuperação

O upload salva o objeto e registra metadados/auditoria em transação. Se essa transação falhar, o servidor tenta remover o objeto. Se também falhar a limpeza, a resposta informa a pendência e o log operacional da função registra somente UUID/caminho, sem senha ou conteúdo. O operador deve reconciliar o objeto com o banco.

A exclusão marca o documento como `deleting` antes de remover o objeto. Colaboradores deixam de vê-lo; o administrador vê “exclusão pendente” e pode repetir a exclusão para finalizar metadados/auditoria. Não há mensagem de sucesso antes da confirmação. Um processo interrompido entre upload e registro ainda pode deixar objeto órfão; reconcilie periodicamente objetos e metadados.

Lotes são processados arquivo a arquivo. O resultado lista os erros e mantém selecionados somente os arquivos com falha. O usuário pode repetir esses itens; falhas de rede após confirmação no servidor exigem conferir a listagem antes de reenviar, pois a versão atual não implementa chave de idempotência entre tentativas.

O cadastro de colaborador remove a conta Auth recém-criada se a inserção do perfil falhar. Se a compensação falhar, a função informa a necessidade de reconciliação. Auth e PostgreSQL não compartilham transação; falhas durante alterações de senha podem exigir novo login ou nova redefinição pelo administrador. As operações priorizam bloquear acesso antes de liberar uma conta parcialmente atualizada.

## Auditoria

Eventos administrativos são gravados pela função com identidade derivada do JWT. Upload e exclusão final são auditados na mesma transação dos metadados. Outros eventos administrativos envolvem serviços distintos e podem exigir reconciliação se a auditoria falhar após a operação principal.

`view-link` e `download-link` significam **emissão de link**, não prova de leitura ou transferência concluída. `session-start` e `session-end` registram solicitações autenticadas da interface, não todo evento do serviço Auth. Logs de autenticação, tentativas malsucedidas e limites de tentativa devem ser acompanhados no Supabase Auth. A tela exibe os últimos 200 eventos; retenção/exportação e backups precisam ser configurados na operação.

## Migração do legado e liberação

1. Inventarie contas, vínculos CPF→documentos e objetos do bucket antigo com acesso administrativo. Confira políticas, funções e permissões atuais; a ausência dessas definições no repositório não comprova que estejam seguras.
2. Recrie as contas no Auth com senhas temporárias entregues por canal apropriado e troca obrigatória. Não copie hashes de senha do legado para tabelas da v3. Mantenha um mapa dos IDs antigos e novos.
3. Reenvie os PDFs pela interface v3 ou por processo administrativo validado que use os mesmos controles. Confira destinatário, nome, tamanho e quantidade; não torne o bucket antigo público para facilitar a migração.
4. Valide a persistência após fechar e reabrir a aplicação. Compare inventário antigo e novo antes de apontar o domínio ao frontend v3.
5. Após a conferência, retire o frontend legado e revogue suas RPCs/permissões de acesso anônimo; revise o bucket antigo. **A implantação aditiva não fecha eventuais exposições do legado.** Planeje a revogação com backup e reversão, sem apagar dados antes da validação.

## Aceite antes de produção

- Administrador e dois colaboradores com CPFs distintos; troca obrigatória no primeiro acesso e após redefinição.
- Colaborador A consegue acessar seu PDF e não consegue listar, assinar URL ou baixar PDF de B, mesmo alterando a requisição ou o armazenamento do navegador.
- Cliente sem JWT, com JWT inválido, de conta inativa ou anterior a reset não acessa documentos nem ações administrativas.
- Cadastro, upload, listagem e download persistem após reabrir a aplicação; erro de rede mostra indisponibilidade, não lista vazia.
- Arquivo falso, vazio, com mais de 50 MiB ou extensão incorreta é rejeitado no servidor, mesmo sem validação do navegador.
- Falha de metadados após upload remove o objeto; exclusão parcial fica pendente e permite retomada.
- Nomes contendo `<`, `>`, aspas e apóstrofos aparecem como texto sem executar HTML.
- Frontend móvel, múltiplos PDFs, download com nome correto e URLs expiradas testados no navegador de uso real.
- Execute os testes SQL em banco local descartável com a migração aplicada: `psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f tests/security.sql`.

Os testes unitários usam clientes simulados. O workflow também executa a migração e `tests/security.sql` em PostgreSQL 17 com primitivas mínimas de Auth/Storage definidas em `tests/postgres-bootstrap.sql`. Esse bootstrap serve exclusivamente à CI e nunca deve ser aplicado no Supabase. Esses testes não substituem o roteiro no Supabase ou o teste de 50 MiB na infraestrutura hospedada (limites de memória/tempo precisam ser confirmados).

## Fora desta entrega

Super Admin, segregação entre empresas, MFA, primeiro acesso com verificação de identidade externa, antivírus, recuperação por email, retenção automatizada, reconciliação agendada e idempotência de upload. A v3 desta branch mantém o modelo de uma organização com papéis `admin`/`employee`; não oferece isolamento multiempresa.
