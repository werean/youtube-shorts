# Decisões

Registro curto das decisões que sustentam a spec. Acrescente no fim; não reescreva entradas antigas. Para reverter uma decisão, crie uma entrada nova que a substitui.

Formato: **Decisão** / **Motivo** / **Consequência**.

Origem de cada entrada:

- **[dono]** decidido pelo dono do projeto em 18/11/2026. Não muda sem ele.
- **[spec]** proposto por esta spec. As que dependem de resposta do dono citam a pergunta (P1, P2, ...) do [README](./README.md).
- **[código]** fato encontrado no mapeamento do código, com o arquivo.
- **[pesquisa]** fato sobre plataforma, com endereço e situação: **confirmado** (está numa página oficial) ou **não confirmado**.

---

## Parte 1 — Produto

### D1 — Contas agrupadas em perfil [dono, a confirmar em P1]

- **Decisão:** é possível ligar várias contas do YouTube e várias do TikTok. Vídeos e preferências ficam separados. As contas que recebem o mesmo conteúdo ficam no mesmo perfil, e na hora de publicar o usuário escolhe os destinos.
- **Motivo:** quem usa as duas plataformas para o mesmo conteúdo precisa mandar o mesmo corte para as duas, sem duplicar vídeo nem preferência.
- **Consequência:** a unidade de separação é o **perfil**, não a conta. Um perfil pode ter zero contas. A palavra "perfil" ainda não foi confirmada pelo dono.

### D2 — Marca d'água é preferência do perfil, com três modos [dono]

- **Decisão:** o usuário envia uma imagem e escolhe a transparência. Modos: adicionar em todos os vídeos, em nenhum, ou perguntar antes de cada renderização.
- **Motivo:** cada canal tem a sua marca.
- **Consequência:** a imagem fica dentro da pasta do perfil e viaja com ele. A renderização ganha um campo opcional que diz se aplica ou não.

### D3 — Uma raiz escolhida pelo usuário; nenhum servidor nosso [dono + spec, P9]

- **Decisão:** o usuário escolhe uma pasta (a raiz), normalmente num disco sincronizado. Abrir o app em outro computador e apontar para a mesma pasta reconstrói a interface.
- **Motivo:** custo zero e nenhuma dependência de serviço nosso.
- **Descartado:** servidor próprio, conta própria, banco de dados na nuvem.
- **Consequência:** tudo o que precisa viajar é arquivo dentro da raiz, com caminho relativo. A spec assume **uma** raiz para vídeos e preferências (P9).

### D4 — O que vai para a raiz e o que não vai [dono]

- **Decisão:**
  - **Vai:** vídeos baixados, cortes gerados, preferências de cada perfil e um arquivo pequeno de informações ao lado de cada vídeo (título, link de origem, data de download, onde já foi publicado, exceção de tamanho).
  - **Não vai:** estado em andamento (transcrição, análise, cortes não aprovados), modelos de IA e dependências, configuração da máquina (modelo em uso, GPU ou CPU, caminhos locais) e credenciais.
- **Motivo:** estado em andamento muda o tempo todo e gera conflito de sincronização; modelo e caminho só fazem sentido na máquina; credencial em pasta sincronizada é vazamento.
- **Descartado:** sincronizar o estado em andamento. O segundo computador refaz o processamento.
- **Consequência:** no segundo computador um vídeo aparece como "baixado", com os cortes já gerados visíveis e publicáveis.

### D5 — Credenciais só em cada computador, no cofre do sistema [dono + spec, P16]

- **Decisão:** token nunca vai para a raiz. Em cada computador, fica no cofre de credenciais do sistema operacional, acessado pela biblioteca `keyring`.
- **Motivo:** o dono decidiu que um computador novo faz login de novo. O cofre do sistema já protege o segredo com a conta do usuário, sem custo e sem inventar criptografia.
- **Descartado:**
  - token na raiz, mesmo cifrado (a chave teria de viajar junto ou ser digitada);
  - arquivo em texto puro dentro de `data/` (os JSON de `data/` são texto puro e os de configuração estão versionados no git);
  - cifrar com chave fixa no código (não protege nada).
- **Consequência:** dependência nova no `backend/pyproject.toml`. Onde não houver cofre disponível, o login vale só enquanto o app estiver aberto e a tela avisa.

### D6 — A conta é reconhecida pelo ID fixo da plataforma; ver e editar não pedem login [dono]

- **Decisão:** o que diz a quem pertencem os dados da pasta é o ID fixo da conta na plataforma. Só publicar exige login.
- **Motivo:** nome e foto mudam; o ID não. E a maior parte do uso do app não é publicar.
- **Consequência:** a raiz guarda `platform` + `platform_account_id` + nome + referência da foto, **sem token**. Ao fazer login num computador novo, o app compara o ID devolvido pela plataforma com o que está na pasta.

### D7 — Arquivo de informações por vídeo: `video.info.json`; o identificador do vídeo é o `job_id` [spec]

- **Decisão:** cada pasta de vídeo ganha `video.info.json`. O campo `video_id` é o `job_id` do computador que criou o vídeo, e os outros computadores adotam esse mesmo `job_id`.
- **Motivo:** hoje `/videos` casa pasta com job pelo caminho completo e, se não acha, **cria um job novo** (`backend/app/api/routers/videos.py:71-94`). Em outro computador o caminho muda e o vídeo duplica.
- **Consequência:** onde existe `video.info.json`, a chave de reconciliação passa a ser o `video_id`. Onde não existe, vale a regra de hoje.

### D8 — Sem raiz, o app funciona como hoje, com um perfil local [spec]

- **Decisão:** enquanto o usuário não escolher uma raiz, os vídeos continuam em `media.base_dir` e existe um único perfil, guardado em `data/profile/`.
- **Motivo:** a experiência de um clique não pode passar a exigir uma escolha de pasta. E a fase 1 (marca d'água) vem antes da pasta portátil.
- **Consequência:** o formato do perfil local é igual ao do perfil na raiz. Criar a raiz copia o perfil local para dentro dela.

### D9 — Divisão de configurações por sobreposição, sem mudar as rotas [spec]

- **Decisão:** com raiz ativa, as chaves que são preferência passam a ser lidas e gravadas em `profile.json`. As rotas `/config/settings` e `/config/tool-configs` continuam com o mesmo formato de entrada e de saída.
- **Motivo:** o frontend reconstrói `preferences` à mão em três lugares (`frontend/src/App.tsx:1621`, `App.tsx:1910`, `frontend/src/hooks/useCutsWorkflow.ts:211-216`). Mudar o formato quebraria os três.
- **Consequência:** a separação acontece numa camada só, no backend. Sem raiz, nada muda.

### D10 — Estado novo da máquina em arquivo novo, `data/machine.json` [spec]

- **Decisão:** raiz escolhida, perfil ativo, identidade da máquina e adiamento do aviso de limite ficam em `data/machine.json`, fora do git.
- **Motivo:** `_parse_settings_dict` descarta toda chave que não conhece (`backend/app/core/settings.py:117-168`), `load_settings` sobrescreve o arquivo com os padrões quando algo falha (`settings.py:203-209`) e `data/settings.json` está versionado com o caminho do usuário dentro.
- **Consequência:** `settings.json` não ganha blocos novos. `.gitignore` ganha as entradas de [architecture.md](./architecture.md), seção 3.

### D11 — Dois computadores: trava de "um por vez", mais revisão e fusão [spec, P6]

- **Decisão:** um arquivo de trava na raiz diz qual computador está escrevendo. Os outros abrem em modo "somente leitura". Além disso, cada `video.info.json` e `profile.json` carrega um número de revisão e é fundido se dois computadores tiverem escrito.
- **Motivo:** não existe nenhuma trava de arquivo ou de processo no backend hoje (mapeamento, risco 9). E a sincronização demora, então a trava sozinha não é garantia.
- **Consequência:** a trava é um aviso, não uma garantia. A garantia de não perder um registro de publicação vem da fusão por identificador.

### D12 — Limpeza: definitiva, nunca automática, desligada por padrão [dono]

- **Decisão:** a exclusão não passa pela lixeira e só acontece quando o usuário clica. Vem desligada.
- **Motivo:** o objetivo é liberar espaço de verdade, e o dono não quer que nada suma sozinho.
- **Descartado:** exclusão automática por agendamento; envio para a lixeira.
- **Consequência:** o motor de limpeza tem duas metades: uma que **calcula** o que venceu (roda à vontade, não apaga) e uma que **executa**, chamada só pela rota de execução.

### D13 — A data que conta é a de download; a ordem é original primeiro, corte depois [dono + spec, P11]

- **Decisão:** vale a data de download gravada pelo app. Apagam-se primeiro os vídeos de origem, do mais antigo para o mais novo; os cortes só entram depois.
- **Motivo:** a data do arquivo muda ao sincronizar ou copiar. Um original baixado do YouTube pode ser baixado de novo; um corte custou processamento.
- **Código:** hoje não existe data de download. A única data é `Job.created_at` (`backend/app/application/job_lifecycle.py:241-246`).
- **Consequência:** `video.info.json` ganha `source.downloaded_at`. Para vídeos antigos, a migração usa `Job.created_at`; se não houver job, usa a data da migração, para nada vencer de surpresa. A forma como os cortes entram na regra de idade está em P11.

### D14 — Proteções da limpeza [dono, com nota do código, P12]

- **Decisão:** mostrar a lista e pedir confirmação; nunca apagar vídeo em processamento; registrar o que foi apagado e por qual regra; destacar cortes aprovados e ainda não publicados; permitir marcar um vídeo como "manter"; arquivos enviados do computador entram como "manter" por padrão.
- **Motivo:** o dono parte do princípio de que o app pode ter movido o original para a pasta dele (`move_uploads`) e que essa pode ser a única cópia.
- **Código:** isso **não acontece hoje**. O arquivo chega por multipart e o backend grava uma cópia (`backend/app/api/routers/jobs_ingest.py:28-46`, `backend/app/domain/ingest/service.py:490-590`). `move_uploads` e `ask_move_on_upload` existem em `backend/app/models/schemas.py:156-159`, mas a ingestão não as lê; no frontend atual o diálogo de "mover" está desligado (`frontend/src/components/redesign/NewVideoModal.tsx` envia direto).
- **Consequência:** a proteção fica como o dono decidiu. A divergência está registrada em P12.

### D15 — Exceção de tamanho [dono + spec, P3]

- **Decisão:** se um único vídeo é maior que o limite, o app avisa e pergunta se abre uma exceção. Com a exceção, o vídeo é baixado e não conta para o limite. Sem ela, não é baixado. A tela mostra os dois totais. A exceção fica gravada em `video.info.json`.
- **Motivo:** o limite não pode impedir o usuário de trabalhar num vídeo grande que ele quer.
- **Consequência:** o tamanho só é conhecido antes do download quando o `yt-dlp` informa. Quando não informa, o download acontece e a pergunta vem depois; o app **não apaga** o vídeo por conta própria.

### D16 — O limite de tamanho vale para a pasta de vídeos inteira [spec, P10]

- **Decisão:** as duas regras de limpeza são da raiz, não do perfil. A conta do tamanho soma todos os perfis.
- **Motivo:** o dono descreveu "tamanho máximo da pasta de vídeos". O que acaba é o disco ou a cota do Drive, que é uma só.
- **Consequência:** as regras ficam em `yts-root.json` (ou em `data/machine.json` quando não há raiz).

### D17 — A limpeza apaga arquivo por arquivo, só dentro da pasta de vídeos [spec]

- **Decisão:** o motor nunca usa `rmtree`. Cada caminho é reconstruído no servidor a partir da varredura, resolvido e conferido contra a pasta de vídeos. Atalho, junção e link simbólico são recusados.
- **Motivo:** as rotas de exclusão atuais usam `shutil.rmtree(..., ignore_errors=True)` e respondem `ok` mesmo quando falham (`videos.py:201-229`). Para uma exclusão em lote e definitiva isso é perigoso.
- **Consequência:** o estado local do job (`data/jobs/<job_id>/`) só é liberado quando o vídeo inteiro some, pela rotina de ciclo de vida que já existe, e só para aquele `job_id`.

### D18 — Rotas sensíveis só aceitam chamadas da própria máquina [spec]

- **Decisão:** as rotas novas que apagam, publicam, mexem em login ou trocam a raiz recusam chamadas que não venham de `127.0.0.1`/`::1`, e recusam também quando o cabeçalho `Origin` aponta para outro lugar que não `localhost`/`127.0.0.1`.
- **Motivo:** o backend escuta em `0.0.0.0`, não tem autenticação e tem CORS aberto (`backend/app/main.py:30-40`). Sem essa trava, qualquer aparelho da rede ou qualquer site aberto no navegador poderia mandar apagar ou publicar.
- **Consequência:** uma dependência FastAPI (`require_local_ui`) aplicada só às rotas novas. As rotas existentes não mudam.

### D19 — Publicação: fila própria, persistida na máquina, um envio por vez [spec]

- **Decisão:** cada destino de cada corte vira uma **publicação**, guardada em `data/publish/queue.json`. Um semáforo novo de tamanho 1 (`PublishQueue`) no escalonador controla os envios.
- **Motivo:** as tarefas de hoje rodam como `BackgroundTasks` e somem se o backend reinicia (mapeamento, tópico 7). Um envio pode levar minutos. Usar a `IOQueue` tomaria as 2 vagas que o download usa (`backend/app/application/scheduler.py:325-350`).
- **Consequência:** depois de um reinício, envios interrompidos ficam **pausados** e o usuário decide se retoma. Nada é reenviado sozinho.

### D20 — "Publicado onde" fica em `video.info.json`, não no corte [spec]

- **Decisão:** o registro de publicação fica no arquivo de informações do vídeo, por arquivo de corte.
- **Motivo:** `cuts.suggested.json` é regravado inteiro pelo `PUT /jobs/:id/cuts`, é apagado ao refazer a transcrição (`job_lifecycle.py:579-602`) e não viaja para a raiz.
- **Consequência:** o segundo computador sabe o que já foi publicado e não publica de novo.

### D21 — Canal de eventos global [spec]

- **Decisão:** rota nova `GET /events`, para avisos que não pertencem a um job (limpeza, publicação, trava).
- **Motivo:** o barramento de eventos só conhece `job_id` e o frontend só abre o fluxo do vídeo ativo (`backend/app/application/runtime_service.py:132-199`, `frontend/src/hooks/useJobEvents.ts`).
- **Consequência:** uma chave reservada no barramento existente; `GET /jobs/:id/events` não muda.

### D22 — Seletor de pasta: hoje não existe um de verdade [código + spec]

- **Código:** `POST /config/select-folder` devolve `{selected: false, path: null}` fora dos testes. `container.folder_picker` nasce `None` (`runtime_service.py:793`) e só é preenchido em `backend/tests/conftest.py:66`.
- **Decisão:** a escolha da raiz funciona sempre por caminho digitado ou colado, com validação. A fase 2 também entrega um seletor nativo para Windows, injetado em `container.folder_picker`.
- **Consequência:** o botão "Alterar pasta" que já existe nas Configurações passa a funcionar também.

### D23 — Marca d'água: imagem normalizada, por cima da legenda [spec, P7]

- **Decisão:** aceitar PNG, JPEG e WebP; regravar como PNG; aplicar depois da legenda e antes da conversão final de cor; posição em grade 3×3 e tamanho em percentual da largura.
- **Motivo:** PNG guarda transparência e o FFmpeg lê sem surpresa. Regravar descarta metadados e garante que o arquivo é mesmo uma imagem. O ponto de entrada no script de filtros é entre a linha da legenda e o `format=yuv420p` (`backend/app/infrastructure/video/filter_script_builder.py:345-352`).
- **Consequência:** segunda entrada no comando do FFmpeg, nos dois caminhos (NVENC e CPU). Sem marca d'água, o comando e o script ficam **idênticos** aos de hoje.

### D24 — O frontend é editado nesta frente, mantendo a identidade visual [dono]

- **Decisão:** quem implementa estas fases pode editar `frontend/`, desde que reuse tokens e componentes do redesenho atual.
- **Motivo:** quase tudo aqui tem tela. Separar em duas sessões atrasaria cada fase.
- **Consequência:** vale só para este trabalho. A regra da seção 2 do `AGENTS.md` continua para o resto.

### D25 — Frontend sem testes automatizados [código]

- **Código:** não há `*.test.*`, nem vitest, jest ou playwright, nem script de teste em `frontend/package.json`.
- **Decisão:** não criar infraestrutura de teste de frontend nesta spec. A verificação é o build e as capturas de tela por estado, como pede `docs/redesign/DESIGN.md`, seção 13.
- **Consequência:** a lógica que precisa de teste (cálculo de limpeza, fusão, validação) fica no backend.

### D26 — YouTube com aplicativo do próprio usuário [spec, P13]

- **Decisão:** cada usuário cria o próprio projeto no Google Cloud e informa as credenciais dele ao app.
- **Motivo:** com um aplicativo único embutido, a verificação do Google e o limite de 100 usuários recaem sobre o autor, e o segredo viajaria dentro do app. As políticas pedem usar só as credenciais atribuídas a você e ao seu projeto (ver R-YT-12).
- **Consequência:** o app precisa de um passo a passo guiado. Em modo de teste do Google o login vence em 7 dias; "reconectar" é fluxo normal, não erro.

### D27 — TikTok: primeira versão envia rascunho, em modo avançado [spec, P14]

- **Decisão:** a primeira versão usa o envio para a caixa de entrada do TikTok (o usuário termina a postagem no app do TikTok), com aplicativo de desenvolvedor do próprio usuário. A fase só começa depois de um teste real.
- **Motivo:** sem auditoria, a publicação direta só sai como privada e exige conta privada (R-TT-2). Criar o aplicativo exige site, termos, política de privacidade e vídeo de demonstração (R-TT-5), o que não é realista para um leigo.
- **Consequência:** o TikTok não entra na experiência de um clique. A tela de publicação já segue as regras de interface do TikTok (R-TT-6), para não ser refeita se um dia houver auditoria.

### D28 — Ordem das fases mantida [spec]

- **Decisão:** marca d'água → pasta portátil → perfis e contas → limpeza → YouTube → TikTok.
- **Motivo:** a marca d'água é a única entrega que não depende de nenhuma pergunta difícil; a pasta portátil define onde tudo o mais é gravado; a limpeza precisa do arquivo de informações; a publicação precisa das contas.
- **Consequência:** a fase 1 cria o perfil local (D8) para não ser refeita na fase 2.

---

## Parte 2 — Restrições das plataformas

Tudo abaixo veio da pesquisa de 18/11/2026 em páginas oficiais, lidas por resumo automático. Antes de virar texto de tela ou código, **reabra a página**. O que a pesquisa não achou em página oficial está marcado como não confirmado. Detalhes e consequências em [platforms.md](./platforms.md).

### YouTube

| # | Restrição | Situação | Fonte |
|---|---|---|---|
| R-YT-1 | Vídeos enviados por projeto não verificado **não ficam mais** presos em privado (mudança de 02/11/2026). | Confirmado na documentação da API | https://developers.google.com/youtube/v3/revision_history , https://developers.google.com/youtube/v3/docs/videos/insert |
| R-YT-2 | A Central de Ajuda **ainda descreve** o travamento em privado, sem apelação. | Contradição entre fontes oficiais; não confirmado qual vale | https://support.google.com/youtube/answer/7300965 |
| R-YT-3 | Cota padrão: 100 chamadas de `videos.insert` por dia, por projeto, em cota própria desde 01/06/2026. Aumento só com auditoria. | Confirmado (a redação do custo é inconsistente entre duas páginas) | https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits , https://developers.google.com/youtube/v3/determine_quota_cost |
| R-YT-4 | Escopo mais estreito para enviar: `https://www.googleapis.com/auth/youtube.upload`. | Confirmado | https://developers.google.com/youtube/v3/docs/videos/insert |
| R-YT-5 | Se esse escopo sozinho basta para `channels.list?mine=true`. | Não confirmado | https://developers.google.com/youtube/v3/docs/channels/list |
| R-YT-6 | Aplicativo de computador: navegador do sistema, retorno em endereço local com porta livre, PKCE sempre; o fluxo antigo de copiar código não é mais aceito; o segredo do cliente não é confidencial. | Confirmado (o literal `127.0.0.1` não foi confirmado; a página diz "loopback IP address") | https://developers.google.com/identity/protocols/oauth2/native-app |
| R-YT-7 | Em modo "Testing": até 100 usuários de teste e a autorização **vence em 7 dias**. | Confirmado | https://support.google.com/cloud/answer/15549945 |
| R-YT-8 | Se publicar o aplicativo no próprio projeto, para uso pessoal, elimina o vencimento de 7 dias. | Não confirmado | — |
| R-YT-9 | Se `youtube.upload` é classificado como escopo "sensível". | Não confirmado (provável) | https://support.google.com/cloud/answer/9110914 |
| R-YT-10 | Vídeo quadrado ou vertical de até 3 minutos vira Short. Não há campo na API para marcar. | Confirmado (a ausência de campo é inferência) | https://support.google.com/youtube/answer/15424877 |
| R-YT-11 | Enviar sempre explícitos: `status.privacyStatus` (o padrão é público), `status.selfDeclaredMadeForKids`, `paidProductPlacementDetails.hasPaidProductPlacement` (sem padrão desde 16/11/2026). | Confirmado. Se a declaração "feito para crianças" pela API substitui o Studio: não confirmado | https://developers.google.com/youtube/v3/docs/videos/insert , https://support.google.com/youtube/answer/9527654 |
| R-YT-12 | Políticas: consentimento antes de enviar; o usuário tem a palavra final; mostrar o canal de destino; revogar o token "right away" ao desconectar; não guardar dados de usuário por tempo indefinido; usar só as credenciais do seu projeto. | Confirmado. Se "cada usuário com o próprio projeto" é expressamente permitido: não confirmado | https://developers.google.com/youtube/terms/developer-policies |
| R-YT-13 | Contas de marca e vários canais no mesmo login: como o canal é escolhido no consentimento. | Não confirmado | https://support.google.com/youtube/answer/3046478 |
| R-YT-14 | Envio retomável: sessão com endereço próprio, retomar em 500/502/503/504 com espera crescente, 404 = sessão vencida. | Confirmado | https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol |
| R-YT-15 | Custo zero do projeto no Google Cloud. | Não confirmado de forma explícita (nenhuma página lida cobra) | https://developers.google.com/youtube/registering_an_application |

### TikTok

| # | Restrição | Situação | Fonte |
|---|---|---|---|
| R-TT-1 | Dois caminhos: publicação direta (escopo `video.publish`) e envio para a caixa de entrada como rascunho (escopo `video.upload`). | Confirmado | https://developers.tiktok.com/doc/content-posting-api-get-started , https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content |
| R-TT-2 | Aplicativo não auditado: até 5 usuários por 24 h, só visibilidade `SELF_ONLY`, e a conta precisa estar privada na hora de postar. | Confirmado (citação conferida duas vezes) | https://developers.tiktok.com/doc/content-sharing-guidelines , https://developers.tiktok.com/doc/content-posting-api-reference-direct-post |
| R-TT-3 | Se o caminho de rascunho sofre a mesma restrição. | **Não confirmado.** As páginas não dizem que sofre nem que é isento | as mesmas |
| R-TT-4 | Rascunho: no máximo 5 envios pendentes por usuário em 24 h. | Confirmado | https://developers.tiktok.com/doc/content-posting-api-reference-upload-video |
| R-TT-5 | Criar o aplicativo exige: site oficial, termos e política de privacidade verificados, vídeo de demonstração, ícone 1024×1024, e passar por revisão. Prazo da revisão: não informado. | Confirmado (prazo não confirmado) | https://developers.tiktok.com/doc/getting-started-create-an-app |
| R-TT-6 | Regras de interface para publicação direta: mostrar o apelido do criador, privacidade sem valor pré-marcado, interações desmarcadas, divulgação comercial desligada, frase de consentimento antes do botão, não enviar nada antes do consentimento. | Confirmado | https://developers.tiktok.com/doc/content-sharing-guidelines |
| R-TT-7 | Login em aplicativo de computador: retorno só em `localhost` ou `127.0.0.1` com porta (curinga aceito), PKCE obrigatório com o desafio em **hexadecimal**. | Confirmado | https://developers.tiktok.com/doc/login-kit-desktop |
| R-TT-8 | Endereço e parâmetros da troca de código por token, do refresh e da revogação; se o segredo do aplicativo é exigido no computador. | **Não confirmado** (as páginas de referência não foram lidas) | https://developers.tiktok.com/doc/oauth-user-access-token-management |
| R-TT-9 | Token de acesso vale 2 h; o de renovação, 180 dias, e **muda a cada renovação**. | Confirmado | a mesma |
| R-TT-10 | `open_id` é único **por aplicativo**; `union_id` é estável entre aplicativos do mesmo desenvolvedor. | Confirmado | https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info |
| R-TT-11 | Vídeo: MP4/WebM/MOV, H.264 recomendado, 23 a 60 quadros por segundo, 360 a 4096 px, até 4 GB, até 10 min (o limite da conta vem da consulta ao criador). Proporção 9:16: nenhum requisito encontrado. | Confirmado (proporção não confirmada) | https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide |
| R-TT-12 | Limites: 6 inícios de envio por minuto por token; número diário de posts por usuário não informado. | Confirmado (valor diário não confirmado) | https://developers.tiktok.com/doc/content-posting-api-reference-direct-post |
| R-TT-13 | Qualquer documento oficial sobre "cada usuário registra o próprio aplicativo". | Não existe página; não confirmado | — |

---

## Parte 3 — Decisões da revisão de 18/11/2026

Duas revisões independentes leram a spec antes de qualquer código. As entradas abaixo registram o que mudou. Onde uma delas substitui uma entrada antiga, a antiga fica como está e a nova diz qual substitui.

### D29 — Quatro rotas existentes passam a ser locais [spec, P22]

- **Decisão:** `DELETE /videos/:job_id`, `DELETE /jobs/:job_id/renders/:file`, `POST /videos/:job_id/archive` e `POST /config/select-folder` ganham `require_local_ui` a partir da fase 2. Corpo e resposta não mudam.
- **Motivo:** as três primeiras apagam com `rmtree` e aceitam chamada de qualquer site e de qualquer aparelho da rede (`backend/app/main.py:28-38`). Em modo raiz, o que elas apagam some em todos os computadores. A quarta passa a abrir uma janela no computador do usuário.
- **Consequência:** **substitui a última frase de D18** ("as rotas existentes não mudam") para essas quatro. É a única exceção à regra "rotas existentes intocadas", e depende de P22. Se o dono disser não, o risco fica registrado em [architecture.md](./architecture.md), seção 15.

### D30 — O estado do job é liberado por função nova; a limpeza não chama o código de excluir vídeo [spec]

- **Decisão:** `JobLifecycleService.release_local_job_state(job_id)`, nova, é o único jeito de a limpeza remover `data/jobs/<job_id>/`. A limpeza tem exatamente duas exclusões fora da pasta de vídeos: essa pasta e `data/jobs/<job_id>/audio_16k.wav`.
- **Motivo:** a "rotina de ciclo de vida que já existe" citada em D17 **não existe**. O código de `videos.py:201-229` é o corpo da rota e faz `rmtree` na pasta do vídeo, na arquivada, na pasta pai de `source_video_path` e em `shorts/` (`job_lifecycle.py:738-742`). Reusá-lo apagaria a pasta que a limpeza promete manter quando há arquivo desconhecido.
- **Consequência:** **substitui a consequência de D17.** O teste estrutural da fase 4 confere que `app/domain/cleanup/` não cita `delete_video`, `delete_render_outputs` nem `rename_video`.

### D31 — Remoção é um dado, não uma ausência [spec]

- **Decisão:** apagar um corte grava `deleted_at` na entrada de `shorts[]`; remover uma conta grava `removed_at`; envio que falhou, foi cancelado ou foi liberado vira `abandoned`. Nenhuma dessas entradas sai do arquivo.
- **Motivo:** a fusão é por união (D11), e uma união nunca "desune": a entrada removida voltaria na primeira fusão com uma cópia antiga. No caso da publicação, isso travaria a conta num `in_progress` fantasma ou perderia o registro.
- **Consequência:** **complementa D11 e D20.** "Tentar de novo" numa publicação que falhou cria uma publicação nova, para o `abandoned` da antiga não brigar com o registro da nova. Um `in_progress` parado (de outro computador há mais de um dia, ou sem envio na fila) pode ser liberado com clique.

### D32 — A trava nunca muda de dono sozinha; o que estava em andamento termina [spec, P6]

- **Decisão:** mesmo com o outro computador parecendo parado, assumir a pasta exige um clique. Quando a trava muda de dono, o que já estava rodando termina e grava o resultado ("escrita de conclusão"); nada novo começa.
- **Motivo:** um `heartbeat_at` parado pode ser só a sincronização **deste** computador pausada. A tomada automática derrubaria o computador que está trabalhando, e um envio terminado depois disso não conseguiria anotar "publicado" na pasta. O outro computador publicaria de novo.
- **Consequência:** **substitui a linha "assume a trava" de D11.** O resultado de um envio é gravado primeiro no disco da máquina e só depois na pasta, e a anotação é repetida até dar certo.

### D33 — Registro de exclusões: um arquivo por computador [spec]

- **Decisão:** em modo raiz o registro fica em `limpeza/<machine_id>.jsonl`. Ele registra também as exclusões que não vêm de regra (cópia de conflito, temporário esquecido, arquivos de perfil).
- **Motivo:** dois computadores acrescentando linhas ao mesmo arquivo num disco sincronizado geram cópias de conflito e linhas pela metade.
- **Consequência:** nenhuma máquina escreve no arquivo de outra. A leitura junta todos e ignora linha incompleta. O módulo nasce na fase 2.

### D34 — `yts-root.json` tem formato definido e não tem índice de perfis [spec]

- **Decisão:** o formato está em [architecture.md](./architecture.md), 2.1. Os perfis são descobertos lendo `perfis/*/profile.json`.
- **Motivo:** a primeira versão da spec não definia o arquivo. Um índice de perfis seria mais uma coisa para fundir entre computadores e para ficar fora de sincronia com as pastas.
- **Consequência:** a ligação `profile_id` → pasta é um mapa em memória. Duas pastas com o mesmo `profile_id`: vale a primeira, com aviso.

### D35 — A raiz e o aplicativo não podem ficar um dentro do outro [spec]

- **Decisão:** a validação recusa raiz dentro do repositório ou do diretório de dados, raiz que os contém, a raiz de um disco, a pasta do usuário e sobreposição com `media.base_dir`. Se o diretório de dados parecer sincronizado, o endereço de sessão de envio fica só em memória.
- **Motivo:** a primeira versão só recusava a raiz **dentro** do app. O caso inverso (o app instalado dentro do Drive, para "abrir em outro computador") faria `data/jobs/` e `data/publish/queue.json` viajarem, contra D4 e D5.
- **Consequência:** novos motivos de recusa na validação e o aviso `data_dir_synced`.

### D36 — Nome de pasta de vídeo validado; `..` recusado nos dois modos [código + spec]

- **Código:** `get_video_folder` (`settings.py:244-246`) deixa passar `..`. Renomear um vídeo para `..` e excluí-lo apaga a pasta de cima (`job_lifecycle.py:707-728`, `videos.py:217-222`).
- **Decisão:** o resolvedor recusa `.`, `..` e nome vazio nos dois modos. Em modo raiz, o nome da pasta é cortado em 80 caracteres, sem ponto ou espaço no fim e sem nome reservado do Windows; a raiz tem no máximo 75 caracteres no Windows.
- **Consequência:** é a única correção de defeito antigo que muda o modo local. Os números 80 e 75 saem da conta de 259 caracteres e podem subir depois da validação manual.

### D37 — Arquivo ilegível nunca é sobrescrito [spec]

- **Decisão:** um `video.info.json`, `profile.json` ou `yts-root.json` que existe e não pode ser lido fica intacto. Não conta como ausente, não é adotado, não entra na limpeza. A saída é um clique ("Recriar as informações"), que renomeia o arquivo em vez de apagar.
- **Motivo:** num disco sincronizado, arquivo pela metade é rotina. Tratar como ausente regravaria com identificador novo e perderia "manter" e o registro de publicações.
- **Consequência:** mesma regra que D10 já tinha para `machine.json`, agora para os arquivos da raiz.

### D38 — Um envio que pode ter dado certo não é refeito sozinho [spec + pesquisa]

- **Pesquisa (confirmado, relido em 18/11/2026):** no envio retomável do YouTube, se o envio já terminou, a consulta devolve a mesma resposta do fim do envio. https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- **Decisão:** essa resposta vira sucesso. Se todos os bytes foram enviados e não dá mais para consultar, a publicação fica `unconfirmed` e o usuário confere no canal.
- **Consequência:** estado novo `unconfirmed` e a rota `POST /publications/:id/resolve`.

### D39 — Enviar a imagem não liga a marca d'água [spec, P21]

- **Decisão:** o envio da primeira imagem deixa o modo em "em nenhum". A tela destaca a escolha.
- **Motivo:** o dono pediu três modos escolhidos pelo usuário. Ligar sozinho em todos os vídeos seria uma decisão de produto tomada em silêncio.
- **Consequência:** se o dono preferir o contrário, muda uma regra da fase 1 e some o destaque.

### D40 — Entregas opcionais [spec, P23]

- **Decisão:** quatro itens que a spec acrescentou além do pedido ficam marcados como opcionais (O1 a O4 no [README](./README.md)): publicação direta no TikTok, botão "Baixar de novo", seletor de pasta nativo no Windows, completar o inventário do `AGENTS.md` com rotas antigas.
- **Motivo:** nenhum foi pedido pelo dono. Cada um pode ser cortado sem reabrir a spec.
- **Consequência:** O1 fica **fora** por padrão (sem auditoria não publica para o público); O2 a O4 ficam **dentro** por padrão.

### D41 — Revogação: token no corpo; não revogar o que pode derrubar outra conta [spec + pesquisa]

- **Pesquisa (relido em 18/11/2026):** a página de OAuth para aplicativo de computador mostra o token da revogação só na URL. Se o corpo é aceito: **não confirmado**. Se revogar um token afeta outras autorizações do mesmo login: **não confirmado**. https://developers.google.com/identity/protocols/oauth2/native-app
- **Decisão:** o app manda o token no corpo; se o passo zero da fase 5 mostrar que não é aceito, usa a URL com os registradores do cliente HTTP calados e filtrados. Na reconexão com a conta errada, não revoga quando o ID é de outra conta conectada nesta máquina. "Sair" avisa quando há outras contas da mesma plataforma.
- **Consequência:** comportamento seguro nos dois casos; os dois pontos estão em [manual-validation.md](./manual-validation.md), fase 5.

---

## Parte 4 — Decisões da segunda conferência (18/11/2026)

Uma nova leitura da spec, com o código aberto ao lado, achou cinco caminhos de perda de dados que a Parte 3 tinha fechado só pela metade. As entradas abaixo dizem o que mudou e qual entrada antiga cada uma substitui ou completa.

### D42 — Na migração, o arquivo de informações chega ao destino primeiro [spec]

- **Decisão:** a migração grava `video.info.json` na pasta de destino **antes** dos cortes e do original. No mesmo disco, o da origem só sai por último. A retomada procura o `video_id` nas pastas que já estão no destino e continua na pasta que o tiver, seja qual for o nome dela.
- **Motivo:** com o arquivo de informações por último, um destino interrompido ficava com cortes ou com o vídeo e sem identidade. Na retomada ele caía na regra "sem arquivo de informações legível → `<nome> (2)`": o vídeo ficava partido em duas pastas (mesmo disco) ou era copiado duas vezes, e a pasta órfã virava depois um vídeo duplicado.
- **Descartado:** um diário da migração em `data/` (o destino ficaria sem identidade para os outros computadores e para quem perdesse o diário).
- **Consequência:** **substitui a ordem do passo 2.5 de [architecture.md](./architecture.md), 8.5.** Enquanto os arquivos não chegam, o destino aparece para outros computadores como "o vídeo ainda não chegou", que é o estado certo. Na retomada, o arquivo da origem é fundido no do destino, não sobrescrito.

### D43 — `video_id` tem formato fixo e é conferido antes de virar job [código + spec]

- **Código:** `create_job`, `save_job` e `job_dir` não conferem o id (`backend/app/application/job_lifecycle.py:229-263`, `backend/app/core/paths.py:65-76`). Todo job de hoje tem id de 32 hex (`uuid4().hex`).
- **Decisão:** `video_id` válido é `^[0-9a-f]{32}$`. Um arquivo de informações com outro valor conta como ilegível e nunca cria job nem vira caminho. Antes da primeira escrita, `data/jobs/<video_id>` é conferido como filho direto de `paths.jobs_dir()`. Um id antigo fora do formato só vale na máquina que já tem um job com exatamente esse id.
- **Motivo:** a reconciliação passa a criar job a partir de um valor lido de arquivo sincronizado. Um `video_id` como `..\..\x` gravaria `job.json` fora de `data/jobs/`, e o `DELETE /videos/:job_id` que já existe faria `rmtree` ali. É o mesmo tipo de buraco que D37 e a regra 6 do README já fechavam para `avatar_file`, `watermark.file` e `merged_conflict_files`.
- **Consequência:** **completa D7.** Tabela de formatos de identificador em [architecture.md](./architecture.md), 5.3.

### D44 — Em modo raiz, a identidade do vídeo não é adivinhada nem trocada sozinha [spec]

- **Decisão:** em modo raiz, uma pasta sem `video.info.json` só é adotada sozinha quando esta máquina já tem job para ela. As outras, as que têm arquivo ilegível sem job e as que repetem um `video_id` ficam como "pastas não reconhecidas": nenhum job, nenhuma escrita, e a adoção só com clique (`POST /storage/folders/adopt`), depois de 10 minutos na lista. Arquivo ilegível nunca faz nascer job, nos dois modos. Uma pasta reconhecida pelo `video_id` desliga dela qualquer outro job local.
- **Motivo:** num segundo computador, o vídeo pode chegar antes do arquivo de informações verdadeiro. Adotar nessa hora cria um arquivo com identificador novo e origem adivinhada, que disputa com o verdadeiro na sincronização; se ele vencer, somem "manter" e o histórico de publicações. Um renomear em outro computador mostra, por um momento, duas pastas com o mesmo `video_id`; trocar o id de uma delas mudaria a identidade do vídeo em todos os computadores. E um job criado pelo caminho enquanto o arquivo está ilegível vira um segundo job na mesma pasta quando o arquivo volta, com o `rmtree` do `DELETE /videos` apontado para ela.
- **Consequência:** **substitui a frase "Onde não existe, vale a regra de hoje" de D7 para o modo raiz** e **completa D37**. Em modo local a adoção automática continua como estava. Preço: em modo raiz, uma pasta de vídeo posta à mão dentro da raiz espera um clique em Configurações → Pasta.

### D45 — Renomear nunca move uma pasta para dentro de outra [código + spec]

- **Código:** `rename_video` faz `shutil.move(old_dir, new_dir)` (`job_lifecycle.py:715-720`); com `new_dir` existente, a pasta vai para **dentro** dela. Acontece ao renomear para o nome de outro vídeo, para `_archived` (`settings.py:293-306`) ou, em modo local, para `logs` (`paths.py:122`). Depois disso, `DELETE /videos/:id` faz `rmtree` no outro vídeo ou em todos os arquivados.
- **Decisão:** nos dois modos, o renomear devolve `400` "Escolha outro nome." para nome reservado e para nome de entrada que já existe na pasta de vídeos, comparando sem diferenciar maiúsculas em qualquer sistema, e confere o destino de novo logo antes de mover. Na ingestão, um título que vira nome reservado usa o `job_id` como pasta.
- **Descartado:** sufixo automático ` (2)` no renomear (o usuário pediu um nome e receberia outro em silêncio).
- **Consequência:** **completa D36.** Junto com D36, são as únicas correções de defeito antigo que mudam o modo local; as duas estão na lista da regra 1 do README.

### D46 — "O vídeo acabou" é o que o arquivo de informações diz [spec]

- **Decisão:** a limpeza só apaga `video.info.json` e libera o estado do job quando `source.deleted_at` está preenchido, toda entrada de `shorts[]` tem `deleted_at` valendo e não há arquivo de vídeo na pasta. A exclusão do `video.info.json` é registrada (`kind: "video_info"`).
- **Motivo:** decidido só pelo disco, "sem original e sem corte" também vale para um original que ainda não chegou pela sincronização e para um corte `missing`. O arquivo de informações seria apagado, e os arquivos atrasados virariam depois um vídeo novo, sem "manter", sem exceção e sem histórico de publicações.
- **Consequência:** **completa D30.** Um vídeo cujo arquivo foi apagado por fora do app nunca é dado como acabado: o arquivo de informações e o estado do job ficam (limite conhecido, [architecture.md](./architecture.md), seção 15).

### D47 — Validação da raiz: pastas gerais do usuário e sobreposição com outra raiz [spec]

- **Decisão:** `too_broad` passa a cobrir as pastas acima da pasta do usuário e as pastas gerais em si (Documentos, Área de Trabalho, Downloads; uma subpasta delas é aceita). Motivo novo `overlaps_other_root`: a pasta escolhida fica dentro de outra raiz (há um `yts-root.json` em alguma pasta acima) ou contém a raiz em uso.
- **Motivo:** uma raiz dentro de outra põe `yts-root.json` e `perfis/` no meio da pasta de vídeos de um perfil. Uma pasta geral como raiz espalha os arquivos do app no meio dos do usuário e faz a varredura ler tudo.
- **Consequência:** **completa D35.** A tabela de [architecture.md](./architecture.md), 8.4, passa de 11 para 12 linhas.

### D48 — Esclarecimentos da fase 1: quando sai `watermark_missing`; os `404` em inglês [spec]

- **Decisão:** `POST /jobs/:id/render`, `/run` e `/jobs/batch/run` conferem a imagem da marca d'água **no pedido**, antes de iniciar qualquer coisa (`400` `watermark_missing`), e o serviço de renderização confere **de novo** antes do primeiro corte; nesse segundo momento a renderização falha com a mensagem fixa no estado e no log do job. Os `404` `"Watermark not found"`, `"Profile not found"` e `"Video info not found"` ficam em inglês, como o `"Video not found"` que já existe, e não são mostrados na tela.
- **Motivo:** a spec dizia "antes de renderizar qualquer corte", um ponto que num fluxo de um clique só chega depois do download e da análise. E a convenção "texto em português" não dizia que esses `404` eram exceção.
- **Consequência:** não muda rota nem formato. A linha "Exclusão" das restrições do README foi reescrita para dizer que a regra "só dentro da pasta de vídeos" é da **limpeza**; a exclusão da imagem da marca d'água é uma das exclusões com clique da regra 3.

### D49 — Ajustes da revisão da fase 1 [spec]

- **Decisão:** (1) o filtro `scale` da marca d'água usa largura e altura explícitas, pares e de no mínimo 2, calculadas no servidor a partir das dimensões da imagem guardada; o encaixe `force_original_aspect_ratio` continua só como reserva quando as dimensões não são conhecidas. Assim uma imagem muito larga (por exemplo 4096x16) não zera uma dimensão no FFmpeg. (2) No fluxo com revisão, a única pergunta da marca d'água é feita em "Gerar cortes" e vale também para "Renderizar aprovados", porque `/jobs/batch/:id/continue` não leva o campo `watermark`. (3) A prévia das configurações usa o quadro de fundo padrão, não o quadro do vídeo aberto, e o fundo da miniatura é o fundo de vidro liso. (4) "Marca d'água" fica logo abaixo de "Aplicação" na navegação. (5) `test_pp_phase1_watermark_flow.py` é um arquivo de teste extra, só com cobertura de integração. (6) Trocar ou remover a imagem durante uma renderização em andamento não é bloqueado nesta fase; as rotas devolvem `409 image_busy` quando o sistema operacional recusa a operação.
- **Motivo:** achados da revisão independente da fase 1.
- **Consequência:** `/batch/run` valida o tipo do campo `watermark` sempre e só confere a imagem quando o lote vai renderizar (`render` e `analysis`). JPEG com orientação EXIF é gravado já girado. O `image_url` inclui a revisão do perfil.
