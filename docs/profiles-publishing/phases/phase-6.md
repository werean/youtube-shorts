# Fase 6 — Publicação no TikTok

> Detalhada até onde a pesquisa permite, que é menos do que no YouTube. **Esta fase tem um portão antes do código.** Se o portão não abrir, a fase para e volta ao dono.

## Em modo local (vale esta seção)

Por decisão do dono (D49), a pasta sincronizada entre computadores está adiada. Esta fase é feita **em um computador**, sobre a fase 5 em modo local. Leia [local-first.md](../local-first.md) antes do resto. **Onde esta seção e o resto do arquivo divergem, vale esta seção.**

Quase nada muda: o portão, o provedor do TikTok, os limites, os erros, as telas e os testes abaixo não dependem da pasta sincronizada e **valem como estão**. As trocas são só estas:

| Onde | Em modo local |
|---|---|
| Depende de | Fase 5 concluída **em modo local** (com a seção "Em modo local" de [phase-5.md](./phase-5.md)). P14 e P23. O portão. |
| Leitura obrigatória | A lista abaixo, mais `local-first.md` e `decisions.md` D49 e D50. |
| Registro de publicação | Gravado como na fase 5 em modo local: função `update` de `local-first.md`, 3.7; `machine_id` e `machine_name` nulos; registro parado só quando a fila deste computador não tem o envio. |
| Foto da conta | `<pasta do perfil em data/>/contas/<account_id>.jpg` (`local-first.md`, 3.2). |
| Varredura de segredos (teste) | Onde diz "fora da raiz", leia "fora de `profile.json`, de `video.info.json` e das pastas de vídeos". |
| Lista de arquivos | Sem trocas. Nenhum arquivo da lista abaixo pertence à parte adiada. |
| Validação manual | Em [manual-validation.md](../manual-validation.md), fase 6, sai o item **[TikTok + 2 PCs]**. Os outros valem. |

`client_fingerprint` continua sendo gravado na conta: ele explica a troca de aplicativo, que pode acontecer em um computador só.

---

*O texto abaixo é o original. Vale no que a seção acima não troca.*

## Objetivo

O usuário avançado conecta uma conta do TikTok a um perfil, usando um aplicativo de desenvolvedor dele, e envia um corte como **rascunho** para a caixa de entrada do TikTok. Ele termina a postagem no app do TikTok.

**A publicação direta é uma entrega opcional (O1 do README, pergunta P23), e o padrão é ela ficar fora.** Sem auditoria ela só sai como "Só eu", em conta privada; não é o que o dono pediu e acrescenta tela e testes. Tudo o que neste arquivo vem marcado **[O1]** só é feito se o dono responder "sim" a P23. Os tipos em `shared/contracts.ts` já preveem o modo `"direct"`, para a entrada posterior não mexer em contrato.

Não é um caminho de um clique para leigos (D27).

## Depende de

- Fase 5 concluída (fila, diálogo de publicar, contas).
- P14 e P23 respondidas.
- O portão abaixo.

## Leitura obrigatória

- [platforms.md](../platforms.md): seções 1, 4, 5 e 6.
- [architecture.md](../architecture.md): seções 4.2 (`client_fingerprint`), 10 e 13.
- [api-contracts.md](../api-contracts.md): seção 6.
- [ui.md](../ui.md): seções 5.3, 13.2, 13.4 e 13.5.
- [decisions.md](../decisions.md): D27, D40 e as linhas R-TT-1 a R-TT-13.

## Portão — três coisas antes do código

### 1. Leitura (quem implementa faz)

Ler no navegador e registrar em `decisions.md`, com endereço e data:

| # | O que conferir | Página |
|---|---|---|
| 1 | Endereço, método e parâmetros da troca de código por token; se `code_verifier` vai nela; se o segredo do aplicativo é exigido em aplicativo de computador. | `oauth-get-a-user-access-token` |
| 2 | Renovação: parâmetros e formato da resposta. | `oauth-refresh-a-user-access-token` |
| 3 | Revogação: endereço e parâmetros; se o token vai no corpo do pedido (o app nunca põe segredo em URL quando há alternativa; `architecture.md`, 10.5). | `oauth-revoke-a-user-access-token` |
| 4 | Se o envio para a caixa de entrada exige a consulta ao criador, e quais das regras de interface da publicação direta valem também para o rascunho. | Referência de `inbox/video/init` e diretrizes de compartilhamento |
| 5 | Valores possíveis do resultado em `status/fetch` para os dois caminhos. | Referência de `status/fetch` |
| 6 | Redação oficial em português da frase de consentimento, se existir. | Diretrizes de compartilhamento |
| 7 | Grafia exata aceita para o endereço de retorno com porta curinga. | `login-kit-desktop` |
| 8 | Se existe um modo de teste (ambiente separado) para aplicativos ainda não revisados, e o que ele permite. | Documentação de criação de aplicativo |

### 2. Decisão do dono

Se o item 1 confirmar que o segredo do aplicativo é exigido, isso é compatível com "aplicativo do próprio usuário" (o segredo é dele e fica no cofre dele). **Não** é compatível com um aplicativo único embutido. Se o dono quiser o aplicativo único, esta fase precisa de outra spec.

### 3. Teste real (o dono faz)

Com um aplicativo de desenvolvedor dele, **não auditado**, o dono envia um vídeo pelo caminho de rascunho, à mão (por exemplo, com as chamadas da documentação), e responde:

- O envio foi aceito?
- O rascunho apareceu na caixa de entrada?
- Deu para postar para o público a partir do rascunho, com a conta pública?

| Resultado | O que acontece com a fase |
|---|---|
| Rascunho aceito e postável para o público | Segue como descrito abaixo. |
| Rascunho aceito, mas com a mesma restrição (só privado, conta privada) | Segue, com o aviso de limitação na tela de preparação e no diálogo de publicar. O dono decide se vale a pena. |
| Rascunho recusado para aplicativo não auditado | **A fase para.** Registrar em `decisions.md` e marcar a fase como bloqueada no README. |
| O aplicativo não passou na revisão | **A fase para.** |

Os itens 1 a 3 do portão estão em [manual-validation.md](../manual-validation.md), fase 6.

## Entregas (se o portão abrir)

### Backend

1. **Provedor do TikTok** em `infrastructure/platforms/tiktok.py`:
   - Autorização em `https://www.tiktok.com/v2/auth/authorize/`, com `client_key`, `scope`, `redirect_uri`, `state`, `response_type=code`, `code_challenge`, `code_challenge_method=S256`. O desafio é o SHA-256 do verificador em **hexadecimal** (R-TT-7). Verificador novo a cada pedido.
   - Troca, renovação e revogação conforme o item 1 a 3 do portão.
   - **Rotação do token de renovação** (R-TT-9): gravar o novo no cofre antes de descartar o antigo; falha na gravação → `login_required`.
   - **Uma renovação por vez por conta** (`architecture.md`, 10.2). `POST /publications/prepare` (consulta ao criador) e o trabalhador da fila podem precisar do token no mesmo instante. Sem trava, os dois renovam com o mesmo token antigo; como o TikTok troca o token a cada renovação, o segundo falha e a conta cai para `login_required` sem motivo. A renovação segura a trava da conta, e quem chega durante ela espera e usa o token de acesso novo, que fica em memória enquanto valer.
   - Identidade: `GET https://open.tiktokapis.com/v2/user/info/` → `open_id`, `display_name`, foto (copiada na hora; a URL vence).
   - `client_fingerprint` gravado na conta. Login com aplicativo diferente do que criou a conta: a sessão termina com a explicação "Esta conta foi conectada com outro aplicativo do TikTok" e a opção de religar.
   - Consulta ao criador (`creator_info/query`), feita em `POST /publications/prepare`, a cada abertura do diálogo. Não é guardada.
   - Envio pelo caminho de rascunho (`inbox/video/init`), com `FILE_UPLOAD`: um pedaço até 64 MB; acima disso, pedaços de 5 a 64 MB, em ordem (R-TT-11). **[O1]** O mesmo pelo caminho direto (`video/init`).
   - Depois de todos os pedaços enviados, se a consulta do resultado não fecha: `unconfirmed`, nunca reenvio automático (`architecture.md`, 13.5).
   - Consulta do resultado (`status/fetch`) com intervalo crescente, até um estado final ou 10 minutos.
2. **Limites:** no máximo 6 inícios de envio por minuto por conta (R-TT-12); a fila espera em vez de falhar.
3. **Validações antes de entrar na fila:** duração do corte ≤ `max_video_post_duration_sec`; se o criador não pode postar agora, o destino volta bloqueado. **[O1]** Privacidade dentro de `privacy_level_options`; conteúdo de marca não pode ser privado.
4. **Estado final `sent_to_inbox`** para o rascunho. **[O1]** `published` para o direto.
5. **Erros mapeados** para as mensagens de `ui.md`, 13.4: `unaudited_client_can_only_post_to_private_accounts` → `private_account_required`; `spam_risk_too_many_posts`, `spam_risk_too_many_pending_share`, `reached_active_user_cap` → `too_many_posts`; `spam_risk_user_banned_from_posting` → `rejected`; `access_token_invalid` → `needs_login`; `scope_not_authorized` → `login_required` com pedido de novo consentimento; `rate_limit_exceeded` → esperar 60 s; `privacy_level_option_mismatch` → `rejected`.
6. **`GET /platforms`** devolve `available: true` para o TikTok.

### Frontend

1. Bloco "TIKTOK" na seção Contas e a tela de preparação com o passo a passo de `platforms.md`, seção 5, o aviso de modo avançado e o link "Entenda as limitações".
2. Opções do TikTok no diálogo de publicar, como em `ui.md`, 13.5. Sem O1: apelido do criador, ajuda do rascunho e aviso de processamento. **[O1]** Modo de envio, privacidade sem valor pré-marcado, interações desmarcadas, divulgação comercial, frase de consentimento, **exatamente** como em `ui.md`, 13.5.
3. Estado "Enviado para o TikTok. Abra o app do TikTok para terminar a postagem." na fila e no cartão.

## Arquivos que pode tocar

Criar:

- `backend/app/infrastructure/platforms/tiktok.py`
- `backend/tests/test_pp_phase6_tiktok_provider.py`, `test_pp_phase6_tiktok_publish.py`, `fakes/fake_tiktok_http.py`
- `frontend/src/components/redesign/PublishTikTokOptions.tsx`

Alterar:

- `backend/app/infrastructure/platforms/__init__.py`, `base.py`
- `backend/app/domain/publishing/service.py`, `worker.py`, `models.py`
- `backend/app/domain/profiles/accounts.py`
- `backend/app/api/routers/platforms.py`, `publications.py`
- `backend/app/models/schemas.py`
- `shared/contracts.ts`
- `frontend/src/components/redesign/PublishDialog.tsx`, `PublishQueueDialog.tsx`, `AccountLinkDialog.tsx`
- `frontend/src/components/redesign/settings/ProfilesSections.tsx`
- `AGENTS.md`, `DESIGN.md` da raiz (se alguma rota mudar; a previsão é que não)

## Fora de escopo

- Auditoria do aplicativo, revisão, qualquer formulário do TikTok.
- Aplicativo único embutido.
- Fotos, `PULL_FROM_URL`, webhooks, capa personalizada, marcação de conteúdo gerado por IA (`is_aigc`) além de enviar `false`.
- Tornar o TikTok parte do fluxo de um clique.

## Testes

Com o HTTP falso do TikTok, respondendo conforme as páginas lidas no portão.

- Desafio PKCE em hexadecimal, com vetor de teste fixo; verificador diferente a cada sessão.
- Rotação: depois de renovar, o cofre tem o token **novo**; gravação falhando → `login_required` e o token antigo não é reutilizado.
- Identidade e `client_fingerprint`; login com outro aplicativo → mensagem própria, sem criar conta duplicada.
- **Renovação ao mesmo tempo:** `prepare` e o trabalhador pedem o token no mesmo instante com o token de acesso vencido → o falso recebe **uma** chamada de renovação, o cofre tem o token novo e a conta continua `connected`.
- `prepare` devolve as opções da conta. **[O1]** Conta pública e conta privada devolvem listas diferentes; nada vem pré-marcado.
- Rascunho feliz: início, `PUT`, consulta do resultado, `sent_to_inbox`.
- Todos os pedaços enviados e a consulta do resultado sem resposta final até o prazo: `unconfirmed`; nenhum início novo é chamado.
- **[O1]** Direto feliz, com `SELF_ONLY`: `published`; a pílula diz "Publicado como 'Só eu' em <conta>".
- Arquivo de 10 MB: um pedaço. Arquivo de 150 MB (simulado, sem alocar): pedaços dentro das faixas, em ordem, soma igual ao tamanho.
- Cada erro da lista de entregas, item 5, vira o estado e a mensagem certos.
- Sétimo início no mesmo minuto espera; não falha.
- Corte mais longo que o limite da conta: destino bloqueado em `prepare`; `POST /publications` recusa.
- Sem `consent: true`: nenhuma chamada de envio.
- Varredura de segredos: token, segredo do aplicativo e `upload_url` fora da raiz, dos logs e das respostas.
- Regressão: os testes da fase 5 passam sem alteração.

## Critério de pronto

1. Portão registrado em `decisions.md`, com os três itens.
2. `pytest` verde, a suíte inteira.
3. `cd frontend && bun run build` sem erro.
4. Capturas em `docs/redesign/screenshots/profiles-publishing/fase-6/`: preparação, opções do TikTok (rascunho; **[O1]** e direto), cada estado de erro, "enviado para a caixa de entrada".
5. Revisão aprovada. **[O1]** Com conferência item a item das regras de interface do TikTok (`platforms.md`, 4.1); sem O1, o revisor confere o que `ui.md`, 13.5, descreve para o rascunho (apelido do criador, aviso de que o usuário termina no app do TikTok) e que nada é enviado antes do consentimento. Quais das regras de interface do TikTok valem também para o rascunho **não foi confirmado**; é o item 4 da leitura do portão.
6. A fase fica `[~]` até o dono fazer um envio real pelo app.

## Validação manual

Em [manual-validation.md](../manual-validation.md), fase 6.

## Modelos

Leitura do portão: Fable. Implementação e testes: Sonnet. Revisão: Opus.
