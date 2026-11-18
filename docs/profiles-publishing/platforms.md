# Plataformas — YouTube e TikTok

O que a pesquisa de 18/11/2026 estabeleceu, o que isso significa para o produto, a primeira versão recomendada para cada plataforma e o passo a passo que o usuário precisa fazer.

## 1. Como ler

- **Confirmado:** está escrito numa página oficial, citada com o endereço.
- **Não confirmado:** a pesquisa não achou em página oficial, ou achou duas páginas oficiais que se contradizem. O texto diz o que foi encontrado e onde.
- As páginas foram lidas por **resumo automático**. Antes de transformar qualquer item em texto de tela ou em código, **reabra a página no navegador**. Isso vale em dobro para citações literais.
- Nenhuma conta foi criada, nenhum aplicativo foi registrado e nenhuma API foi chamada para escrever este documento.
- Fontes de terceiros (blogs, ferramentas de agendamento) foram vistas só como pista e **não** sustentam nada aqui.

A tabela resumida das restrições, com um identificador por linha (R-YT-n, R-TT-n), está em [decisions.md](./decisions.md), parte 2.

## 2. YouTube

### 2.1 O que foi estabelecido

**Envio do vídeo** — https://developers.google.com/youtube/v3/docs/videos/insert

| Item | Situação |
|---|---|
| Método `videos.insert`. Escopo mais estreito: `https://www.googleapis.com/auth/youtube.upload`. | Confirmado |
| Campos: `snippet.title`, `snippet.description`, `snippet.tags[]`, `snippet.categoryId`, `status.privacyStatus`, `status.selfDeclaredMadeForKids`. | Confirmado |
| Se `privacyStatus` for omitido, o padrão é **público**. A documentação recomenda privado ou não listado em testes. | Confirmado |
| Arquivo de até 256 GB; tipos `video/*` e `application/octet-stream`. | Confirmado |
| `paidProductPlacementDetails.hasPaidProductPlacement` não tem mais padrão `false` desde 16/11/2026; é preciso enviar. | Confirmado |
| `selfDeclaredMadeForKids` só é atualizado se enviado (desde 15/10/2026). | Confirmado |
| Limite de caracteres do título e da descrição. | Não consta na pesquisa |
| Valores válidos de `categoryId`. | Não consta na pesquisa |

**Envio retomável** — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol (confirmado)

1. `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=...`, com os cabeçalhos `X-Upload-Content-Length` e `X-Upload-Content-Type` e os metadados no corpo.
2. A resposta `200` traz `Location`: o endereço da sessão.
3. `PUT` do arquivo nesse endereço. `201` ao concluir.
4. Em `500`, `502`, `503` ou `504`: esperar (tempo crescente) e retomar.
5. Para saber onde parou: `PUT` vazio com `Content-Range: bytes */TOTAL`; a resposta `308` traz `Range`.
6. `404`: a sessão venceu; recomeçar.
7. Enviar em pedaços é possível (múltiplos de 256 KB), mas desencorajado.

Três pontos da mesma página, relidos em 18/11/2026 para a revisão desta spec:

| Item | Situação |
|---|---|
| Se o envio **já tinha terminado**, a consulta do passo 5 devolve "the same response that it sent when the upload originally completed". O envio concluído responde `201` com o recurso do vídeo. | Confirmado. É o que permite tratar um tempo esgotado que na verdade deu certo, sem reenviar. |
| O endereço da sessão "has a finite lifetime and eventually expires". | Confirmado. A duração **não é informada**. |
| O endereço da sessão do exemplo traz um identificador na própria URL (`...&upload_id=...`). | Confirmado. Por isso a URL inteira é tratada como segredo e nunca vai para log nem para mensagem de erro. |

**Vídeos presos em privado** — o ponto mais importante

| Fonte | O que diz | Situação |
|---|---|---|
| Histórico de revisões da API, 02/11/2026 — https://developers.google.com/youtube/v3/revision_history | Vídeos enviados por projetos não verificados não ficam mais restritos a privado. | Confirmado na documentação |
| Página de `videos.insert` | "Videos uploaded from unverified API projects are not restricted to private viewing mode." | Confirmado na documentação |
| Central de Ajuda — https://support.google.com/youtube/answer/7300965 | Ainda descreve o travamento em privado, sem apelação; o criador teria de reenviar. | **Contradiz as duas acima.** Não se sabe qual está atualizada. |
| Se um vídeo já travado pode ser liberado depois no Studio. | — | Não confirmado |

A mudança tinha 16 dias quando a pesquisa foi feita.

**Cota** — https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits

| Item | Situação |
|---|---|
| Padrão por projeto: 100 chamadas de `videos.insert` por dia, em cota própria desde 01/06/2026. | Confirmado. A redação do custo é inconsistente entre a página do método ("1 unit in the Video Uploads quota bucket") e https://developers.google.com/youtube/v3/determine_quota_cost ("100 quota per day. Each call costs 1 quota."). Na prática: 100 envios por dia. |
| `channels.list` custa 1 unidade da cota geral. | Confirmado |
| Aumento de cota só com auditoria de conformidade, por formulário. Critérios e prazo. | Existência confirmada; critérios e prazo não confirmados |
| A que horas a cota diária zera. | Não consta na pesquisa |

**Login** — https://developers.google.com/identity/protocols/oauth2/native-app

| Item | Situação |
|---|---|
| Aplicativo de computador: abre o navegador do sistema e recebe o retorno num endereço local, em porta livre. | Confirmado |
| PKCE sempre; `S256` recomendado. | Confirmado |
| O fluxo antigo de copiar e colar o código não é mais aceito. | Confirmado |
| Aplicativo de computador é cliente público: "cannot keep secrets confidential". | Confirmado |
| O token de renovação vem automaticamente; há um limite de tokens por par aplicativo/usuário, e passar dele invalida os mais antigos. | Confirmado |
| O literal `127.0.0.1` no retorno. | Não confirmado (a página diz "loopback IP address") |
| Revogar: pedido para `https://oauth2.googleapis.com/revoke`, com o token "as a parameter". O único exemplo da página põe o token **na URL** (`?token=...`), com cabeçalho de formulário. | Confirmado (relido em 18/11/2026) |
| Se o token pode ir **no corpo** do pedido (formulário), em vez da URL. | **Não confirmado.** A página não diz. |
| O token revogado pode ser o de acesso ou o de renovação; revogar o de acesso revoga também o de renovação correspondente. | Confirmado |
| Se revogar um token derruba **outras** autorizações do mesmo login naquele aplicativo (por exemplo, outro canal ligado com outro token). | **Não confirmado.** |

**Modo de teste e verificação** — https://support.google.com/cloud/answer/15549945

| Item | Situação |
|---|---|
| Em "Testing": até 100 usuários de teste, aviso de aplicativo não verificado, e a autorização **vence em 7 dias** (o token de renovação também). | Confirmado |
| Em "In production" sem verificação, com escopo sensível: tela de "aplicativo não verificado" e limite de 100 novos usuários na vida do projeto. | Confirmado |
| Se `youtube.upload` é classificado como "sensível". | Não confirmado. Provável: a página https://support.google.com/cloud/answer/9110914 cita escopos da API do YouTube como exemplo de sensíveis. Conferir no console. |
| Se publicar o aplicativo no próprio projeto, para uso de uma pessoa só, elimina o vencimento de 7 dias. | Não confirmado |
| Verificação de escopo sensível: política de dados, vídeo de demonstração, cerca de 10 dias úteis. | Confirmado — https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification |

**Qual canal está atrás do login** — https://developers.google.com/youtube/v3/docs/channels/list

| Item | Situação |
|---|---|
| `channels.list?mine=true` devolve os canais do usuário; `id` é o ID do canal. | Confirmado |
| Se o escopo `youtube.upload` sozinho basta para essa chamada. | Não confirmado |
| Contas de marca e vários canais num login: como o canal é escolhido na tela de consentimento; se um token vale para vários canais. | Não confirmado. A Ajuda (https://support.google.com/youtube/answer/3046478) diz que aplicativos que não suportam troca de canal podem entrar no canal errado. |

**O que é Short** — https://support.google.com/youtube/answer/15424877

| Item | Situação |
|---|---|
| Vídeo quadrado ou vertical de até 3 minutos vira Short (desde 15/10/2024). Resolução máxima 1080p. | Confirmado |
| Não existe campo na API para marcar um vídeo como Short. | Inferência; não confirmado de forma explícita |
| Formato do link público de um Short a partir do ID devolvido. | Não consta na pesquisa |

**Políticas** — https://developers.google.com/youtube/terms/developer-policies

| Item | Situação |
|---|---|
| Pedir consentimento expresso antes de enviar em nome do usuário (III.E.3.d); o usuário tem o controle final (III.C.3). | Confirmado |
| Mostrar com clareza a qual canal a ação se refere (III.E.3.e). | Confirmado |
| Ao desconectar: revogar o token "right away" e apagar os dados em 7 dias (III.D.2.b.3). | Confirmado |
| Tokens podem ser guardados pelo tempo necessário (III.E.4.a); dados de usuário não podem ser guardados por tempo indefinido, em geral 30 dias (III.E.4.c). | Confirmado |
| Usar só as credenciais atribuídas a você e ao seu projeto; não compartilhar credenciais (III.D.1.d). | Confirmado |
| Se "cada usuário com o próprio projeto" é expressamente permitido. | Não confirmado. É compatível pela leitura, mas nenhuma página afirma. Isto não é aconselhamento jurídico. |
| Se a exigência de política de privacidade aceita pelo usuário (III.A.2) vale para um app 100% local. | Não confirmado |

### 2.2 Consequências para o produto

1. **A barreira histórica caiu na documentação, mas não dá para confiar sem testar.** Depois de cada envio, o app lê a privacidade que o YouTube devolveu e avisa se ficou diferente da pedida. O app nunca diz "publicado como público" sem ter lido isso.
2. **Aplicativo do próprio usuário** (D26). Mantém custo zero e não cria dependência de um projeto central. Custa um passo a passo guiado.
3. **"Entrar de novo" é rotina.** Em modo de teste o login vence em 7 dias. A tela trata isso como estado normal ([ui.md](./ui.md), 5.4).
4. **Todo envio manda explícitos** `privacyStatus`, `selfDeclaredMadeForKids` e `hasPaidProductPlacement: false`. Nenhum deles fica por conta do padrão da plataforma.
5. **O canal de destino aparece na tela** antes de cada publicação, com nome e foto.
6. **100 envios por dia por projeto.** O limite é do projeto no Google Cloud, não do computador: dois computadores com a mesma credencial dividem a mesma cota. O app conta os envios do dia **neste computador**, mostra o número com esse rótulo ("N envios hoje neste computador") e nunca usa a contagem para bloquear. Quem diz que a cota acabou é o erro devolvido pelo YouTube, tratado com mensagem própria.
7. **Nada a fazer para "ser Short":** o corte vertical de até 3 minutos já é. Cortes do app com mais de 3 minutos (a spec do produto fala em até ~160 s, então não deve acontecer) sairiam como vídeo comum; a tela avisa se a duração passar de 180 s.
8. **Desconectar revoga** o token na hora e apaga o que está no cofre. Dois cuidados, porque duas coisas não foram confirmadas:
   - **Token fora da URL.** Uma URL com token pode ir parar no log do cliente HTTP e em mensagens de exceção. O app manda o token no corpo do pedido (formulário). Se o passo zero da fase 5 mostrar que o Google só aceita na URL, a chamada usa a URL, e a proteção passa a ser só a de [architecture.md](./architecture.md), 10.5: registradores do cliente HTTP calados e filtrados, e nenhuma mensagem de erro montada com o texto da exceção. As duas proteções existem nos dois casos.
   - **Outros canais do mesmo login.** Como não se sabe se revogar derruba os outros, o app não revoga quando o login "errado" de uma reconexão é de outra conta já conectada neste computador, e avisa em "Sair" quando há outras contas do YouTube conectadas ([architecture.md](./architecture.md), 10.4).
9. **Envio sem confirmação não é reenviado sozinho.** Se todos os bytes foram enviados e a resposta se perdeu, o app primeiro consulta a sessão (que devolve a resposta final se o envio terminou). Se nem isso for possível, a publicação fica "sem confirmação" e o usuário confere no canal antes de decidir.

### 2.3 Primeira versão recomendada

| Item | Escolha |
|---|---|
| Credencial | Do próprio usuário: projeto dele no Google Cloud, cliente OAuth do tipo aplicativo de computador. |
| Login | Navegador do sistema; retorno em `http://127.0.0.1:<porta livre>/oauth/callback`; PKCE `S256`; `state` aleatório. O ouvinte local existe por no máximo 5 minutos. Chamada com `state` errado é ignorada e não gasta a sessão; o ouvinte encerra na primeira chamada com o `state` certo. |
| Escopo | `youtube.upload`. Se o teste real mostrar que não basta para descobrir o canal, acrescentar o escopo de leitura que a documentação indicar (não consta na pesquisa qual). |
| Identidade | `channels.list?mine=true&part=snippet` logo depois do login. Mais de um canal: o usuário escolhe. |
| Envio | Retomável, num `PUT` só (sem pedaços). O endereço da sessão fica na fila local. |
| Metadados | Título, descrição (com as hashtags no fim), privacidade escolhida pelo usuário, "feito para crianças" respondido pelo usuário, `hasPaidProductPlacement: false`, `categoryId` configurável. |
| Privacidade inicial | "Privado" na primeira publicação de cada conta; depois, a última escolha. |
| Depois do envio | Ler `status.privacyStatus` da resposta e gravar em `result.privacy`. |
| Fora da primeira versão | Miniatura, playlists, agendamento, `tags[]`, legendas, edição do vídeo depois de publicado. |

Tudo isso funciona **antes de qualquer auditoria**, se a documentação de 02/11/2026 estiver valendo. Se a Central de Ajuda é que estiver certa, o vídeo fica privado e o usuário é avisado; o produto não quebra.

### 2.4 O que precisa de teste real antes de marcar a fase 5 como pronta

Está em [manual-validation.md](./manual-validation.md), fase 5. Os três que mais pesam:

1. Um vídeo enviado como "público" por um projeto novo, não verificado, **fica público**?
2. Com o aplicativo em "Testing", o login vence mesmo em 7 dias? E publicando o aplicativo no próprio projeto?
3. `youtube.upload` sozinho permite `channels.list?mine=true`?

## 3. YouTube — passo a passo para o usuário

Fonte dos passos 1, 2 e 5: https://developers.google.com/youtube/registering_an_application (confirmado). Os passos 3 e 4 (tela de consentimento e usuário de teste) **não foram lidos na pesquisa**: a existência do modo de teste e dos usuários de teste está confirmada, mas os nomes dos menus podem ser diferentes. Quem implementar a fase 5 confere e ajusta o texto.

Nenhuma página lida cobra por isso. Que o projeto é gratuito **não está afirmado de forma explícita** em nenhuma delas.

O app mostra estes passos no diálogo "Preparar o YouTube neste computador", cada um com um botão "Abrir":

| # | O que o usuário faz | Texto na tela |
|---|---|---|
| 1 | Entrar no Google Cloud Console e criar um projeto. | "Crie um projeto no Google Cloud. Pode dar qualquer nome." |
| 2 | Ativar a "YouTube Data API v3" no projeto. | "Ative a YouTube Data API v3 nesse projeto." |
| 3 | Configurar a tela de consentimento como uso externo, em modo de teste. | "Preencha a tela de consentimento. Só o nome do app e o seu e-mail são necessários." |
| 4 | Adicionar o próprio e-mail (o da conta do canal) como usuário de teste. | "Adicione o e-mail da conta do seu canal como usuário de teste." |
| 5 | Em Credenciais, criar um "ID do cliente OAuth" do tipo "App para computador". | "Crie uma credencial do tipo 'App para computador'." |
| 6 | Copiar o ID e a chave secreta, ou baixar o arquivo `.json`. | "Copie o ID do cliente e a chave secreta, ou baixe o arquivo." |
| 7 | Colar no app, ou importar o arquivo. | "Cole aqui ou importe o arquivo." |

Avisos que a tela mostra junto:

- "Você faz isso uma vez por computador."
- "Enquanto o seu projeto estiver em modo de teste, o Google pede que você entre de novo a cada 7 dias."
- "Guarde o arquivo baixado: você vai usar o mesmo em outro computador."
- "**Não guarde este arquivo na pasta dos vídeos.** Ela pode ser sincronizada, e este arquivo é uma chave."

Num computador novo, o usuário repete só o passo 7 (com o mesmo arquivo) e entra de novo.

O lugar mais à mão para "guardar para o outro computador" é justamente a pasta sincronizada, e credencial não pode ficar lá. Por isso, além do aviso, o app olha os lugares que a varredura já visita (a raiz, as pastas de perfil e as pastas de vídeo) e, se achar um arquivo com nome `client_secret*.json` (o padrão do arquivo baixado do console; **conferir o nome no passo zero da fase 5**), mostra o aviso `credentials_file_in_root`. O app não lê, não move e não apaga esse arquivo.

## 4. TikTok

### 4.1 O que foi estabelecido

**Os dois caminhos** — https://developers.tiktok.com/doc/content-posting-api-get-started e https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content

| Item | Publicação direta (`video.publish`) | Rascunho na caixa de entrada (`video.upload`) |
|---|---|---|
| Início | `POST https://open.tiktokapis.com/v2/post/publish/video/init/` | `POST https://open.tiktokapis.com/v2/post/publish/inbox/video/init/` |
| Consulta prévia | `POST /v2/post/publish/creator_info/query/` | A página não menciona (não confirmado se é exigida) |
| Envio do arquivo | `source=FILE_UPLOAD` com `video_size`, `chunk_size`, `total_chunk_count`; a resposta traz `upload_url` e `publish_id`; depois `PUT` no `upload_url` | Igual |
| Campos de publicação | `post_info`: `privacy_level` (obrigatório), `title` (até 2200 unidades UTF-16), `disable_duet`, `disable_stitch`, `disable_comment`, `video_cover_timestamp_ms`, `brand_content_toggle`, `brand_organic_toggle`, `is_aigc` | Nenhum. Só `source_info`. O usuário completa no app do TikTok. |
| Resultado | `POST /v2/post/publish/status/fetch/` com `publish_id` | O mesmo |
| O que o usuário vê | O post sai no perfil, depois de alguns minutos de processamento | Um rascunho. O desenvolvedor "should inform users that they must click on inbox notifications to continue the editing flow in TikTok and complete the post". |
| Limites | 6 inícios por minuto por token | 6 por minuto por token; no máximo 5 envios pendentes por usuário em 24 h |

Tudo confirmado, salvo onde indicado. Limite diário de posts por usuário: existe o erro `spam_risk_too_many_posts`, sem valor publicado (não confirmado).

**Aplicativo não auditado** — https://developers.tiktok.com/doc/content-sharing-guidelines (conferida duas vezes)

Citações literais, confirmadas:

- "Unaudited API Clients can allow up to 5 users to post in a 24 hour window."
- "All user accounts using the API client to post must be set to private at the time of posting."
- "Unaudited API Clients can only post contents in `SELF_ONLY` viewership."
- "To lift this restriction, your API client must undergo an audit to verify compliance with our Terms of Service."

E na referência da publicação direta: "All content posted by unaudited clients will be restricted to private viewing mode."

| Pergunta | Resposta |
|---|---|
| Sem auditoria, dá para publicar para o público? | **Não**, pela publicação direta. Confirmado. |
| O rascunho na caixa de entrada sofre a mesma restrição? | **Não confirmado.** As páginas do rascunho não citam "unaudited"; a restrição está escrita para a publicação direta. Não há texto dizendo que o rascunho é isento, nem que não é. Só um teste real ou o suporte do TikTok responde. |

**Criar o aplicativo e passar pela revisão** — https://developers.tiktok.com/doc/getting-started-create-an-app

| Item | Situação |
|---|---|
| Existe a plataforma "Desktop"; exige o endereço de um site oficial. | Confirmado |
| Endereços de Termos de Serviço e Política de Privacidade verificados antes do envio. | Confirmado |
| Pelo menos um vídeo de demonstração do fluxo completo (até 5, até 50 MB cada). | Confirmado |
| Ícone 1024×1024, até 5 MB. | Confirmado |
| Prazo da revisão. | Não confirmado |
| Formulário de auditoria da API de postagem (https://developers.tiktok.com/application/content-posting-api): existe, exige login. Passos, documentos e prazo. | Existência confirmada; o resto não confirmado |

**Regras de interface para publicação direta** — https://developers.tiktok.com/doc/content-sharing-guidelines (confirmado)

1. Mostrar o apelido do criador.
2. Consultar a situação do criador antes de publicar; se ele não puder postar agora, parar e pedir para tentar depois.
3. Título editável, inclusive o texto e as hashtags pré-preenchidos.
4. Privacidade escolhida à mão, só entre as opções devolvidas, **sem valor pré-marcado**.
5. Comentário, dueto e costura: o usuário liga à mão; **nenhum vem marcado**; o que a conta tem desativado aparece cinza.
6. Divulgação comercial desligada por padrão; ao ligar, "Your brand" e/ou "Branded content". Rótulos: "Promotional content" / "Paid partnership". Conteúdo de marca não pode ser privado.
7. Frase de consentimento antes do botão: "By posting, you agree to TikTok's Music Usage Confirmation."
8. Não enviar nada ao TikTok antes do consentimento. Mostrar prévia. Avisar que o processamento leva alguns minutos. Consultar o resultado.

**Login** — https://developers.tiktok.com/doc/login-kit-desktop e https://developers.tiktok.com/doc/oauth-user-access-token-management

| Item | Situação |
|---|---|
| Retorno: até 10 endereços, estáticos, só `localhost` ou `127.0.0.1`, com porta; porta curinga `*` aceita e recomendada. | Confirmado |
| Autorização em `https://www.tiktok.com/v2/auth/authorize/`, com `client_key`, `scope`, `redirect_uri`, `state`, `response_type=code`, `code_challenge`, `code_challenge_method=S256`. | Confirmado |
| PKCE obrigatório. O `code_challenge` é o SHA-256 do verificador em **hexadecimal** (não em base64url). | Confirmado |
| Endereço e parâmetros da troca do código por token, da renovação e da revogação. | **Não confirmado.** As páginas de referência não foram lidas. |
| Se o segredo do aplicativo é exigido num aplicativo de computador. | **Não confirmado.** As páginas lidas sugerem que sim. |
| Token de acesso: 2 horas. Token de renovação: 180 dias, e **muda a cada renovação**. | Confirmado |

**Identidade** — https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info

| Item | Situação |
|---|---|
| `GET https://open.tiktokapis.com/v2/user/info/` com o escopo `user.info.basic` devolve `open_id`, `union_id`, `avatar_url`, `display_name`. | Confirmado |
| `open_id` é único por aplicativo; `union_id` é estável entre aplicativos do mesmo desenvolvedor. | Confirmado |
| Regra oficial para várias contas no mesmo aplicativo. | Não confirmado como regra explícita |

**Consulta ao criador** — https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info (confirmado)

Devolve `creator_avatar_url` (válida por 2 horas), `creator_username`, `creator_nickname`, `privacy_level_options`, `comment_disabled`, `duet_disabled`, `stitch_disabled`, `max_video_post_duration_sec`. A privacidade enviada precisa estar na lista devolvida. A consulta é feita ao abrir a tela de publicação.

**Vídeo** — https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide (confirmado)

MP4 (recomendado), WebM ou MOV; H.264 recomendado; 23 a 60 quadros por segundo; 360 a 4096 px; até 4 GB; até 10 minutos pelo envio, com o limite da conta vindo de `max_video_post_duration_sec`. Pedaços de 5 a 64 MB (o último até 128 MB); arquivo com menos de 5 MB vai de uma vez; mais de 64 MB exige pedaços. `403` no envio indica `upload_url` vencida (validade não confirmada). Nenhum requisito de proporção foi encontrado. Os cortes do app (1080×1920, H.264, MP4) cabem nessas faixas.

**Cada usuário registrar o próprio aplicativo:** não existe página oficial sobre isso (não confirmado).

### 4.2 Consequências para o produto

1. **Publicar direto e para o público exige auditoria.** Sem ela, só `SELF_ONLY` e em conta privada. Isso não é "publicar".
2. **O rascunho é o único candidato a funcionar sem auditoria**, e ainda é uma aposta: se ele escapa da restrição não foi confirmado. Mesmo que escape, o aplicativo precisa estar aprovado para o escopo `video.upload`.
3. **Não há caminho de um clique para leigos no TikTok nesta versão.** Criar o aplicativo exige site, termos, política de privacidade, vídeo de demonstração e revisão. É um modo avançado (D27).
4. **Um aplicativo único do projeto, embutido no app,** exigiria que o autor passasse pela revisão e, para publicar ao público, pela auditoria; e provavelmente um segredo embutido num programa distribuído. Fica fora desta spec e é assunto da pergunta P14.
5. **A tela de publicação já nasce conforme as regras de interface** (seção 4.1), para não ser refeita.
6. **O token de renovação muda a cada uso:** gravar o novo antes de descartar o velho.
7. **A conta é o `open_id` daquele aplicativo.** Trocar de aplicativo muda o ID; a spec guarda uma marca do aplicativo (`client_fingerprint`) para explicar isso ao usuário em vez de criar uma conta duplicada.
8. **Limites a respeitar:** 6 inícios por minuto por token; 5 rascunhos pendentes por 24 h; duração máxima da conta.

### 4.3 Primeira versão recomendada

| Item | Escolha |
|---|---|
| Credencial | Aplicativo de desenvolvedor do próprio usuário (modo avançado). |
| Login | Navegador do sistema; retorno em `http://127.0.0.1:<porta>/oauth/callback`; PKCE `S256` com desafio em hexadecimal. |
| Escopos | `user.info.basic` e `video.upload`. `video.publish` só existe com a entrega opcional O1, e só se o usuário ativar a publicação direta. |
| Identidade | `GET /v2/user/info/` → `open_id`, `display_name`, foto. |
| Caminho padrão | **Rascunho na caixa de entrada.** A tela diz: "O vídeo vai para a caixa de entrada do TikTok. Você termina a postagem no app do TikTok." Estado final: `sent_to_inbox`. |
| Caminho opcional (**entrega O1, pergunta P23; padrão: fica fora da primeira versão**) | Publicação direta, com todas as regras de interface. A tela avisa antes: "Sem auditoria do TikTok, o vídeo só pode sair como 'Só eu' e a conta precisa estar privada." Sem auditoria ela não publica para o público, então não é o que o dono pediu; está descrita para poder entrar depois sem refazer a tela. |
| Envio | `FILE_UPLOAD`. Um pedaço só quando o arquivo tem até 64 MB (o caso comum de um corte); em pedaços acima disso. |
| Fora da primeira versão | Fotos, `PULL_FROM_URL`, webhooks, capa personalizada, auditoria. |

**A fase 6 não começa sem o passo zero dela:** ler as páginas de referência que ficaram de fora e fazer um envio real de rascunho com um aplicativo não auditado. Se o rascunho for bloqueado, a fase para e volta ao dono.

## 5. TikTok — passo a passo para o usuário

Montado a partir de https://developers.tiktok.com/doc/getting-started-create-an-app e https://developers.tiktok.com/doc/login-kit-desktop. Não existe guia oficial para "use o seu próprio aplicativo"; a ordem abaixo é dedução do que as páginas exigem. Prazos de revisão não são informados.

| # | O que o usuário faz |
|---|---|
| 1 | Criar uma conta em developers.tiktok.com. |
| 2 | Criar um aplicativo e escolher a plataforma "Desktop". |
| 3 | Informar o endereço de um site oficial, e os endereços de Termos de Serviço e de Política de Privacidade. Esses endereços precisam ser verificados. |
| 4 | Enviar um ícone de 1024×1024 (JPEG ou PNG, até 5 MB). |
| 5 | Acrescentar os produtos "Login Kit" e "Content Posting API". |
| 6 | Cadastrar o endereço de retorno: `http://127.0.0.1:*/oauth/callback` (porta curinga). A grafia exata aceita pelo formulário precisa ser conferida. |
| 7 | Pedir os escopos `user.info.basic` e `video.upload`. |
| 8 | Gravar e enviar um vídeo de demonstração do fluxo completo. |
| 9 | Enviar para revisão e esperar a aprovação. |
| 10 | Copiar a chave (`client_key`) e o segredo do aplicativo e colar no app. |

A tela de preparação do TikTok mostra, antes da lista: "Este é um caminho para quem já tem site e paciência com formulários. O TikTok analisa o pedido e pode demorar." e um link "Entenda as limitações", que abre um texto curto com as consequências 1 a 3 da seção 4.2.

## 6. O que continua sem resposta

| # | Pergunta | Como resolver |
|---|---|---|
| 1 | YouTube: a documentação de 02/11/2026 vale, ou a Central de Ajuda? | Envio real ([manual-validation.md](./manual-validation.md)) |
| 2 | YouTube: `youtube.upload` basta para descobrir o canal? | Teste real |
| 3 | YouTube: publicar o aplicativo no próprio projeto tira o vencimento de 7 dias? | Teste real |
| 4 | YouTube: como funciona a escolha de canal com contas de marca? | Teste real com uma conta de marca |
| 5 | YouTube: a declaração "feito para crianças" pela API substitui a do Studio? | Teste real |
| 6 | YouTube: a política de 30 dias para dados de usuário vale para app local com credencial própria? | Leitura dos termos pelo dono (P18) |
| 7 | YouTube: limites de caracteres, valores de categoria, formato do link do Short, horário em que a cota zera | Leitura das páginas de referência no passo zero da fase 5 |
| 8 | TikTok: o rascunho sofre a restrição de aplicativo não auditado? | Envio real, ou suporte do TikTok |
| 9 | TikTok: endereços de token, renovação e revogação; segredo exigido no computador? | Leitura das páginas de referência no passo zero da fase 6 |
| 10 | TikTok: prazo de revisão e de auditoria; critérios | Só fazendo o pedido |
| 11 | TikTok: validade da `upload_url`; limite diário de posts | Teste real |
| 12 | TikTok: existe redação oficial em português para a frase de consentimento? | Leitura das diretrizes no passo zero da fase 6 |
| 13 | YouTube: a revogação aceita o token no corpo do pedido, em vez da URL? | Leitura no passo zero da fase 5; se não fechar, teste real |
| 14 | YouTube: revogar o token de um canal derruba os outros canais do mesmo login? | Teste real com dois canais do mesmo login |
| 15 | YouTube: quanto tempo vale o endereço de uma sessão de envio? | A página não informa; teste real |
| 16 | YouTube: nome exato do arquivo de credenciais baixado do console | Leitura no passo zero da fase 5 |
