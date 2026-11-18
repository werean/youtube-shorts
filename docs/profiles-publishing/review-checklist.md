# Checklist de revisão independente

> **Para as fases 2 a 6, o revisor recebe também [local-first.md](./local-first.md).** A pasta sincronizada entre computadores está adiada (D49). Os itens deste checklist que tratam de raiz, trava, somente leitura, fusão, cópias de conflito, temporários, migração ou segundo computador recebem "não se aplica", e alguns itens mudam de leitura. A lista dos dois grupos está em `local-first.md`, 2.4. Encontrar código de algo adiado no diff é `falha` na seção H ("trouxe algo a mais").

Usado pelo revisor (Opus) ao fim de cada fase. O revisor recebe este arquivo, o arquivo da fase, o diff, a saída do `pytest`, a saída do build do frontend e as capturas de tela. Ele **não** recebe o raciocínio de quem implementou.

O revisor responde cada item com `ok`, `falha` ou `não se aplica`, citando arquivo e linha quando for `falha`.

- Uma `falha` nas seções **A a E** reprova a fase.
- A seção **B** não admite "aprovado com ressalvas" nas fases 2 e 4.
- O revisor não confia em descrição: ele abre o código. Onde o item diz "busque", ele faz a busca.

## A. Segredos nunca chegam à pasta sincronizada nem aos logs

Vale a partir da fase 3.

- [ ] Nenhum modelo gravado na raiz (`profile.json`, `video.info.json`, `yts-root.json`, `yts-lock.json`, registro da limpeza) tem campo de token, código, segredo, verificador ou endereço de sessão de envio. Confira os modelos, não só os exemplos.
- [ ] Busque no diff por `token`, `secret`, `refresh`, `code_verifier`, `upload_url`, `Location`, `Authorization`. Cada ocorrência que grava em disco vai para o cofre ou para `data/publish/queue.json`, e para mais nenhum lugar.
- [ ] Toda mensagem de log dos módulos de contas, plataformas e publicação passa por `redact()`. Nenhum `logger.*` nesses módulos recebe objeto de resposta HTTP, cabeçalho ou URL de retorno inteiros.
- [ ] Nenhuma exceção com token ou URL de sessão na mensagem é repassada ao cliente em `detail`. Busque `str(exc)`, `repr(exc)` e `f"{exc}"` nos módulos de contas, plataformas e publicação: `detail` e `error.message` vêm de tabela de textos fixos.
- [ ] Os registradores `httpx`, `httpcore` e `urllib3` estão em `WARNING` ou acima e com o filtro de `redact()`. Nenhum segredo vai em URL de pedido quando há alternativa; a revogação manda o token no corpo (ou a exceção está registrada em `decisions.md` pelo passo zero).
- [ ] Nenhuma resposta de rota **e nenhum evento de `GET /events`** devolve `client_id`/`client_secret`, token, nem o conteúdo de `resume` de uma publicação. `auth_url` só sai na resposta de `link/start` e `reconnect/start`; `GET /accounts/link-sessions/:id` não a devolve e é rota local.
- [ ] Nenhum segredo vai em parâmetro de URL **do próprio app** (rotas, links, `EventSource`).
- [ ] O token de acesso não é gravado em lugar nenhum; vive só em memória.
- [ ] `state`, verificador PKCE e `session_id` (128 bits) são gerados com fonte criptográfica (`secrets`). `state` e verificador são usados uma vez e descartados. A sessão de login vence.
- [ ] O ouvinte de retorno escuta só em `127.0.0.1`, numa porta livre, por tempo limitado. Chamada com `state` errado é **ignorada sem encerrar** o ouvinte nem a sessão; ele encerra na primeira com o `state` certo.
- [ ] O teste de varredura existe e procura os **valores** dos segredos da fixture em todos os arquivos da raiz, de `data/`, nos logs capturados (inclusive os dos registradores de biblioteca), nas respostas e nos eventos de `/events`. Ele falha se alguém remover o `redact()` (confira lendo o teste).
- [ ] `data/publish/` e `data/machine.json` estão no `.gitignore`.
- [ ] No frontend: nenhum segredo em `localStorage`, em `console.log` ou em estado que vá para um log. `frontend/src/api/client.ts` faz `console.log` do corpo e dos cabeçalhos de toda chamada (`client.ts:5-7`); a fase 3 tem de ter alterado o arquivo para não registrar corpo nem cabeçalhos das rotas `/platforms/*`. Abra o arquivo e confira.
- [ ] O arquivo `.json` de credenciais importado é lido no navegador e só os dois valores são enviados; o arquivo não é guardado.
- [ ] Com o cofre indisponível, o código cai para memória, **não** para arquivo.
- [ ] O cofre só conta como `"os"` quando o backend ativo está na lista fixa. Um backend de arquivo de texto (`keyrings.alt`), nulo, falho ou desconhecido cai para memória; há teste que injeta um backend de texto puro.
- [ ] Nenhuma rota `async` chama o cofre direto: as chamadas vão para uma thread, com tempo limite.
- [ ] A renovação de token segura uma trava por conta; duas renovações ao mesmo tempo viram uma chamada só.
- [ ] A validação da raiz recusa pasta que **contém** o repositório ou o diretório de dados efetivo (`YTS_DATA_DIR` inclusive), além da que fica dentro deles. Com o diretório de dados parecendo sincronizado, o endereço da sessão de envio não é gravado em `queue.json`.
- [ ] Na reconexão com a conta errada, o token novo **não** é revogado quando o ID devolvido é de outra conta conectada nesta máquina.

## B. Nada é apagado sem clique; nada fora da pasta de vídeos é apagado

Vale a partir da fase 2 (cópias de conflito, temporários, migração, nome de pasta) e é o centro da fase 4.

**Sem clique**

- [ ] Busque todas as chamadas de `unlink`, `remove`, `rmdir`, `rmtree`, `shutil.move`, `os.replace` e `rename` no diff. Para cada uma, diga quem a chama e a partir de qual ação do usuário.
- [ ] A função de exclusão da limpeza tem **um** ponto de chamada: a rota `POST /cleanup/execute`. Não é chamada por temporizador, por evento de inicialização, pelo recálculo, pelo `preflight`, nem pelo "adiar". O "Apagar este vídeo" do diálogo de vídeo acima do limite passa por essa mesma rota, com um plano manual; ele **não** chama `DELETE /videos/:job_id`.
- [ ] A rota de execução exige `confirm: true`, um `plan_id` válido e uma lista não vazia de itens. Sem um deles, nada é apagado.
- [ ] Só os `item_ids` enviados são apagados. Itens do plano que o usuário desmarcou ficam.
- [ ] O recálculo (ao iniciar, a cada 30 minutos, depois de download e de renderização) só lê.
- [ ] Vídeo que passou do limite depois de baixado fica no disco até o usuário decidir.
- [ ] A migração nunca apaga a origem quando copia entre discos. No mesmo disco, ela leva só `video.info.json`, `shorts/*.mp4` e `video.<ext>`, arquivo por arquivo; `transcrições/` não vai para a raiz. O único `unlink` da migração é o do `video.info.json` da **origem**, no mesmo disco, depois de conferir que o do destino existe, é legível e tem o mesmo `video_id`, e que os cortes e o original chegaram.
- [ ] Na migração, o **primeiro** arquivo gravado na pasta de destino é `video.info.json`. A retomada procura o `video_id` nas pastas que já estão no destino e continua na que o tiver. Há teste que interrompe em cada ponto (antes do arquivo de informações, depois dele, depois dos cortes, depois do original), no mesmo disco e em outro, e confere: uma pasta só, nenhum `<nome> (2)`, nenhum arquivo duplicado.
- [ ] A migração nunca funde duas pastas: o destino é conferido pelo `video_id`; arquivado vai para `videos/_archived/`; há teste com um vídeo ativo e um arquivado de mesmo nome.
- [ ] **Em modo raiz, nenhuma pasta é adotada sozinha se esta máquina não tinha job para ela.** Há teste: raiz com uma pasta com `video.mp4` e sem `video.info.json`, `data/` de um segundo computador → depois de listar, a árvore da raiz é idêntica e nenhum job foi criado. A adoção dessas pastas só acontece por `POST /storage/folders/adopt`, com `confirm`, e só depois de 10 minutos na lista.
- [ ] Um `video.info.json` ilegível **nunca faz nascer um job**, em nenhum modo. Duas pastas com o mesmo `video_id` em modo raiz: nenhum dos dois arquivos é regravado sem clique. Em nenhum teste sobram dois jobs apontando para a mesma pasta.
- [ ] Cópias de conflito só são apagadas pela rota própria, e só as já fundidas. Cada nome de `merged_conflict_files` passa pelas cinco conferências (nome simples, casa com o padrão, diferente do oficial, mesma pasta, arquivo comum) antes e no instante de apagar. Há teste com a lista adulterada (`../x/video.mp4`, `video.mp4`, `video.info.json`).
- [ ] Temporários esquecidos de vídeo só são apagados por `POST /storage/leftovers/clear`, com clique, e só os desta máquina.
- [ ] A **única** exclusão sem clique é a de temporários de JSON. Confira no código, um a um: só nos caminhos listados em `architecture.md`, 6.2 (a raiz, `perfis/*/`, `perfis/*/videos/*/`, `perfis/*/videos/_archived/*/`), sem recursão e sem seguir link; só o nome exato `<arquivo oficial>.<m8 desta máquina>.<hex>.tmp`; só com mais de uma hora. Há teste em que um `outro.json.tmp` antigo e o temporário de outra máquina sobrevivem.
- [ ] A trava **nunca** muda de dono sem clique, nem quando `heartbeat_at` está parado.
- [ ] Um `video.info.json`, `profile.json` ou `yts-root.json` que existe e não pode ser lido **nunca** é sobrescrito, adotado, renomeado ou apagado sem clique. Há testes com arquivo de 0 bytes, JSON cortado e `schema_version` 2 que comparam o conteúdo antes e depois.
- [ ] Na tela: o botão de apagar fica desabilitado com zero itens; itens "ainda não publicados" pedem a segunda confirmação; cortes vêm desmarcados.
- [ ] Limpeza desligada por padrão. Com ela desligada, nenhum aviso aparece e nenhuma rota existente muda.

**Só dentro da pasta de vídeos**

- [ ] `shutil.rmtree` não aparece em `app/domain/cleanup/`, em `app/domain/profiles/` nem em `app/domain/storage/`.
- [ ] `app/domain/cleanup/` **não chama** o código de `DELETE /videos/:job_id`, `delete_render_outputs` nem `rename_video`. Busque os três nomes.
- [ ] Nenhum caminho usado para apagar vem do corpo do pedido. O cliente manda `item_id`; o servidor reconstrói o caminho a partir do plano guardado.
- [ ] Antes de cada `unlink`: o caminho é resolvido e conferido como descendente da pasta de vídeos; link simbólico e junção são recusados (arquivo "só na nuvem" **não** é recusado); o nome do arquivo casa com o padrão esperado para o tipo do item; o `video_id` e o tamanho batem com o plano; o arquivo de informações está legível.
- [ ] **Só duas exclusões da limpeza acontecem fora da pasta de vídeos**, e as duas são estado local do job: `data/jobs/<job_id>/` (pela função nova `release_local_job_state`, que valida o `job_id` com `_validate_safe_segment` e confere que o caminho é filho direto de `paths.jobs_dir()`) e `data/jobs/<job_id>/audio_16k.wav`. Cada uma tem teste próprio. Não há uma terceira.
- [ ] Pasta só é removida com `rmdir` (vazia). Arquivo desconhecido dentro da pasta do vídeo sobrevive, **inclusive depois** de o estado do job ser liberado.
- [ ] **"O vídeo acabou" é decidido pelo arquivo de informações**, relido do disco: `source.deleted_at` preenchido, toda entrada de `shorts[]` com `deleted_at` valendo e nenhum arquivo de vídeo na pasta. Abra o código e confira que a decisão não é "a pasta está sem vídeo". Há teste com original `source_absent` e com corte vivo `missing`: nos dois o `video.info.json` e `data/jobs/<id>/` ficam.
- [ ] Durante a execução, os jobs do plano ficam marcados "em limpeza" e `ingest`, `render` e `run` deles devolvem `409`.
- [ ] Os testes de caminho cobrem `..`, caminho absoluto, link para fora e nome inesperado, e há um arquivo-sentinela fora da pasta de vídeos conferido no fim.

**Travessia de caminho, em geral**

- [ ] Todo parâmetro de rota que vira parte de caminho (`profile_id`, `account_id`, `job_id`, `file`, `session_id`, `migration_id`, `publication_id`, `plan_id`) é validado por formato (lista de caracteres permitidos) **antes** de tocar o disco.
- [ ] `profile_id` nunca é usado direto como nome de pasta: a pasta vem do mapa montado ao ler `perfis/*/profile.json` (não existe índice de perfis em `yts-root.json`).
- [ ] O nome do arquivo enviado como marca d'água não influencia o caminho gravado.
- [ ] **Nenhum caminho é montado a partir de campo de JSON sincronizado.** `avatar_file` e `watermark.file` são informativos; foto e marca d'água são lidas, gravadas e apagadas pelos nomes fixos `contas/<account_id>.jpg` e `marca-dagua/watermark.png`. Há teste com os dois campos adulterados.
- [ ] `DELETE /profiles/:id` apaga arquivo por arquivo, `profile.json` por último, pastas com `rmdir`; "vazio" é nenhuma entrada em `videos/` (teste com pasta só de cortes, com arquivado e com arquivo desconhecido).
- [ ] O nome de pasta de vídeo `.`, `..` ou vazio é recusado nos dois modos; o resolvedor nunca devolve caminho com `..`. Há teste: renomear para `..` e chamar `DELETE /videos/:id` não toca nada fora da pasta do vídeo.
- [ ] **Renomear nunca move uma pasta para dentro de outra.** Renomear para o nome de outro vídeo (inclusive só com a caixa diferente), para `_archived` e, em modo local, para `logs` devolve `400` e não move nada; a existência do destino é conferida de novo logo antes de mover. Há teste com arquivo-sentinela na pasta do outro vídeo e em `_archived/`, seguido de `DELETE /videos/:id`: os dois sobrevivem.
- [ ] **`video_id` lido do disco é conferido antes de virar job.** Só `^[0-9a-f]{32}$` chega a `create_job`; o caminho `data/jobs/<video_id>` é conferido como filho direto de `paths.jobs_dir()`. Há teste com `video_id` adulterado (`..\..\x`, `../x`, caminho absoluto, vazio, `CON`) e um arquivo-sentinela fora de `data/jobs/`: nenhum job nasce e nada é escrito.
- [ ] `POST /storage/root` refaz a validação inteira (as 12 linhas de `architecture.md`, 8.4): recusa caminho dentro do repositório ou do diretório de dados, caminho que os **contém**, a raiz de um disco, a pasta do usuário, as pastas acima dela e as pastas gerais (Documentos, Área de Trabalho, Downloads), sobreposição com `media.base_dir`, pasta dentro de outra raiz e pasta que contém a raiz em uso. Não cria `yts-root.json` nem `perfis/` antes de validar.
- [ ] `POST /publications` só aceita `file` que tenha entrada viva em `shorts[]` do arquivo de informações daquele vídeo **e** exista no disco. Cortes anteriores à spec têm entrada (conferência de `architecture.md`, 5.5); há teste.
- [ ] As rotas marcadas "local" em `api-contracts.md` têm mesmo a dependência `require_local_ui`. Liste as que apagam, publicam, mexem em login ou trocam a raiz e confira uma a uma.

**Registro**

- [ ] Cada exclusão da limpeza gera uma linha no registro, gravada (com `fsync`) antes do `unlink`, com a regra. Falha ao registrar impede a exclusão. Isso inclui o `video.info.json` de um vídeo que acabou (`kind: "video_info"`).
- [ ] As outras exclusões com clique dentro da raiz também são registradas: cópia de conflito, temporário esquecido, arquivos de perfil.
- [ ] Em modo raiz o registro é um arquivo por computador (`limpeza/<machine_id>.jsonl`); nenhuma máquina escreve no arquivo de outra. A leitura ignora linha incompleta.
- [ ] O caminho no registro é relativo.

## C. A identidade visual foi mantida

O revisor olha as capturas da fase ao lado das de `docs/redesign/screenshots/` e lê o diff de `frontend/`.

- [ ] Nenhuma cor escrita à mão (`#...`, `rgb(...)`, `zinc-*`, `slate-*`, `gray-*`) em arquivo novo. Só classes e variáveis dos tokens. Exceção: valores que já existem nos componentes copiados.
- [ ] Nenhuma alteração em `frontend/src/lib/tokens.css` nem em `frontend/tailwind.config.ts`.
- [ ] Diálogos novos usam `GlassDialog` (`glass--strong`, `rounded-panel`, `z-modal`). Nenhum uso novo de `AppDialog`, `AppButton`, `AppInput`, `AppSelect`, `GlassButton`, `GlassToast`, `ui/Modal`.
- [ ] Botões e campos são pílulas, com as classes de `ui.md`, 0.2.
- [ ] Ícones só de `@phosphor-icons/react`, peso `regular`; `fill` só em estado ativo. Nenhum emoji. Nenhuma outra biblioteca de ícones no `package.json`.
- [ ] Nenhuma dependência nova no `frontend/package.json`.
- [ ] Sem brilho, gradiente, sombra colorida ou animação de quique. Animações usam as durações dos tokens.
- [ ] Fora das Configurações não aparece percentual, tamanho em bytes sem necessidade, nome de arquivo técnico, código de erro nem termo como "token", "OAuth", "API", "quota". Dentro dos diálogos de preparação de plataforma, os termos que o usuário vai ver no site da plataforma são permitidos.
- [ ] Todo texto está em português do Brasil e bate, palavra por palavra, com `ui.md`. Divergência é falha, a menos que registrada em `decisions.md`. Exceção: a frase de consentimento do TikTok, em inglês.
- [ ] Salvamento automático nas Configurações; nenhum botão "Salvar".
- [ ] Os avisos novos não cobrem a pílula central do modo imersivo nem o dock, **nem a barra lateral quando ela está à direita** (há captura com a barra fixada à direita).
- [ ] Toda classe usada existe: busque no diff classes de cor de fundo e confira contra `frontend/tailwind.config.ts` (por exemplo, `bg-bg-elevated` não existe).
- [ ] Os nomes dos arquivos criados batem com a lista da fase e com `ui.md`, 0.3 (a tabela de lá lista também os diálogos de cada fase).
- [ ] A pílula e a fila dizem a privacidade real: um vídeo que ficou privado, não listado ou "Só eu" nunca aparece só como "Publicado".
- [ ] Nenhum texto manda o usuário fazer algo que o app não faz (por exemplo, "mova os vídeos" para outro perfil).
- [ ] Usuário com um perfil, sem raiz, sem conta e com a limpeza desligada vê a tela principal **igual** à de antes (compare as capturas). As únicas novidades visíveis sem entrar nas Configurações: o diálogo de primeira execução (uma vez; P20) e, a partir da fase 5, o botão "Publicar" quando houver plataforma disponível.
- [ ] Acessibilidade: `role="dialog"`, `aria-modal`, Esc, foco preso e devolvido; `aria-label` em botão só de ícone; grupos de escolha com `radiogroup` e setas; `prefers-reduced-motion` respeitado.
- [ ] As capturas pedidas no arquivo da fase existem, uma por estado.

## D. Sem raiz e sem perfil configurados, só mudou o que está na lista

- [ ] Existe teste que roda os fluxos principais (criar job, ingestão, transcrição, análise, renderização, listar vídeos, excluir) com `data/` vazio e sem raiz, e compara com o comportamento anterior.
- [ ] A suíte que já existia passa **sem alteração nos testes** (só `conftest.py` pode mudar). Liste os testes antigos que foram editados; cada edição precisa de justificativa.
- [ ] Em modo local, os caminhos devolvidos pelo resolvedor são os mesmos de antes para vídeo, transcrição, cortes, arquivados e logs.
- [ ] Em modo local, `/config/settings` e `/config/tool-configs` leem e gravam nos mesmos arquivos e com o mesmo conteúdo.
- [ ] Sem marca d'água configurada, o comando do FFmpeg e o script de filtros são idênticos aos de antes (teste de comparação de texto).
- [ ] `data/settings.json`, `default_configs.json`, `custom_settings.json` e `saved_llm_prompts.json` não ganharam chave nova.
- [ ] Nenhuma rota existente passou a exigir cabeçalho, corpo ou parâmetro novo.
- [ ] O fluxo de um clique (`POST /jobs/:id/run`, lote) não para para perguntar nada quando nenhuma das funções novas está ligada.
- [ ] Os efeitos novos em modo local são só estes, e não há outro:
  - arquivos: `data/machine.json`, `data/profile/` e um `video.info.json` em cada pasta de vídeo;
  - tela: o diálogo de primeira execução, uma vez (P20);
  - comportamento: renomear para um nome que vira `.`, `..` ou vazio, para um nome reservado (`_archived`, `logs`) ou para o nome de uma pasta que já existe devolve `400`, e a ingestão troca um nome reservado pelo `job_id` (correção de defeito);
  - comportamento: uma pasta com `video.info.json` ilegível que a máquina ainda não conhecia não vira vídeo sozinha; aparece em Configurações → Pasta como "não reconhecida";
  - se P22 = sim: `DELETE /videos/:job_id`, `DELETE /jobs/:job_id/renders/:file`, `POST /videos/:job_id/archive` e `POST /config/select-folder` recusam chamada de outro aparelho ou de outro site, com o mesmo contrato para o frontend local.
- [ ] Em modo local, enviar uma imagem de marca d'água não muda o modo (continua "em nenhum" até o usuário escolher; P21).
- [ ] Raiz configurada e indisponível: o app não cria a pasta, não apaga `machine.json`, não volta para o padrão em silêncio.
- [ ] Nenhum caminho absoluto dentro da raiz (o teste automático existe e cobre todos os JSON).

## E. Rotas e contratos só cresceram

- [ ] Nenhuma rota da seção 4.1 do `AGENTS.md` foi removida, renomeada ou teve o formato de resposta alterado. Compare com a lista. As quatro rotas de P22 só ganharam `require_local_ui`; corpo e resposta são os mesmos.
- [ ] As rotas novas da fase estão em `api-contracts.md`, no inventário do `AGENTS.md` e no `DESIGN.md` da raiz, com o mesmo caminho e método.
- [ ] Todo campo novo em resposta de rota existente é opcional. Todo campo novo em corpo de rota existente é opcional e, ausente, mantém o comportamento.
- [ ] O diff de `shared/contracts.ts` só tem linhas acrescentadas. Nenhuma interface existente perdeu ou mudou o tipo de um campo. `AppSettings` está intacta.
- [ ] Erros seguem `{ "detail": "..." }`, com `code` opcional. Os valores de `code` estão na tabela de `api-contracts.md`.
- [ ] `JobStatus` e o modelo `Cut` não mudaram. `cuts.suggested.json` continua válido.
- [ ] Não há colisão de rota (por exemplo, `/videos/archived` contra `/videos/:job_id/...`; `/publications/prepare` contra `/publications/:id/...`). Confira a ordem de registro.
- [ ] Toda escrita de `.json` é atômica; dentro da raiz, passa por `synced_store.update` (trava por arquivo, temporário de nome único, novas tentativas, mudança reaplicada se a releitura não bate). Busque escritas de JSON na raiz que não passem por ela: não pode haver nenhuma.
- [ ] Nenhum arquivo fora da lista da fase foi alterado.

## F. Testes

- [ ] Nenhum teste usa rede, conta real, FFmpeg real, GPU, cofre real do sistema ou disco sincronizado real. Confira que o falso de HTTP falha se receber um endereço inesperado.
- [ ] Os falsos devolvem dados no formato da plataforma; o código de produção não reconhece o falso nem muda de comportamento sob teste.
- [ ] A variável de desenvolvimento que liga a plataforma falsa (fase 3) não altera mais nada.
- [ ] O relógio é injetado onde há prazo (trava, adiar, plano, sessão de login, idade do vídeo). Nenhum `sleep` real longo.
- [ ] "Dois computadores" é testado com dois `data/` e uma raiz.
- [ ] Existe o teste de escritores ao mesmo tempo no mesmo `video.info.json` (N threads, nenhuma entrada some, nenhum `.tmp` sobra), e ele falha se a trava por caminho for removida (confira lendo o teste).
- [ ] A fusão tem teste para remoção: corte apagado, conta removida e publicação `abandoned` não voltam ao fundir com uma cópia antiga.
- [ ] Cada linha das tabelas de regra em `architecture.md` (fusão, trava, resolução da marca d'água, elegibilidade, novas tentativas) tem um teste.
- [ ] O caminho de falha de cada operação tem teste.

## G. Plataformas

Vale nas fases 5 e 6.

- [ ] O passo zero (fase 5) ou o portão (fase 6) está registrado em `decisions.md`, com endereço e data.
- [ ] Nenhuma constante, limite ou texto sobre a plataforma existe no código sem estar em `platforms.md` ou no registro do passo zero.
- [ ] O que continua "não confirmado" tem comportamento seguro nos dois casos e está em `manual-validation.md`.
- [ ] Nada é enviado à plataforma antes de `consent: true`. `POST /publications/prepare` só faz leituras.
- [ ] O destino (nome e foto da conta) aparece na tela antes de publicar.
- [ ] YouTube: privacidade, "feito para crianças" e `hasPaidProductPlacement` vão explícitos em todo envio; a privacidade mostrada depois é a **devolvida** pela plataforma.
- [ ] TikTok, só se a entrega opcional O1 (publicação direta) entrou: cada uma das 8 regras de interface de `platforms.md`, 4.1, conferida na captura de tela. Sem O1: não existe escolha de modo nem nenhum campo de publicação direta na tela, e o código não pede o escopo `video.publish`.
- [ ] Publicação interrompida por reinício fica pausada; não é retomada sozinha.
- [ ] **Um envio que pode ter dado certo nunca é refeito sozinho.** A consulta que devolve "envio já concluído" vira sucesso; sessão vencida ou reinício depois de todos os bytes enviados vira `unconfirmed`, e só o usuário decide reenviar.
- [ ] O registro de publicação é relido do disco antes de aceitar uma nova; a fusão nunca perde uma publicação. Falha e cancelamento viram `abandoned`, não remoção.
- [ ] O resultado de um envio é gravado em `data/publish/queue.json` **antes** da tentativa de anotar na pasta, e a anotação é repetida até dar certo, inclusive depois de reiniciar e em somente leitura. Há teste com a escrita na raiz falhando.
- [ ] Um `in_progress` só é liberado com clique, e só quando está parado; `allow_repeat` não passa por cima de um envio em andamento.
- [ ] "Sair", "Remover", "Mover" e remover a credencial são recusados com envio em andamento para a conta.
- [ ] A contagem local de envios do dia aparece como "neste computador" e não bloqueia; o bloqueio de cota vem do erro da plataforma.
- [ ] Desconectar revoga o token na plataforma e apaga do cofre, nessa ordem, e apaga do cofre mesmo se a revogação falhar.

## H. Leitura crítica

- [ ] Existe algum caminho em que o usuário perde um arquivo que não escolheu perder?
- [ ] Existe algum caminho em que um vídeo é publicado sem um clique naquele diálogo, ou publicado duas vezes?
- [ ] Um leigo que nunca abre as Configurações continua conseguindo colar um link e receber os vídeos, sem nenhuma pergunta nova além da primeira execução?
- [ ] O que acontece se a pasta sumir no meio de um download, de uma renderização, de uma exclusão, de um envio?
- [ ] O que acontece se dois computadores acharem que são donos da trava ao mesmo tempo? Algum dado é perdido?
- [ ] O diff resolve só o que a fase pede, ou trouxe algo a mais?

## Saída do revisor

```
Fase: N
Veredito: aprovado | aprovado com ressalvas | reprovado
Falhas: [seção.item, arquivo:linha, descrição]
Ressalvas: [...]
Buscas feitas: [padrão buscado → quantas ocorrências, onde]
O que eu não consegui verificar: [...]
```
