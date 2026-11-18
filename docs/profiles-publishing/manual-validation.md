# Validações manuais

> **A pasta sincronizada entre computadores está adiada (D49).** Todos os itens marcados **[Drive]** ou **[2 PCs]** ficam adiados, junto com alguns itens **[PC]** da fase 2 que tratam de migração e de escolha da pasta. A lista do que sai, do que continua e dos itens novos está em [local-first.md](./local-first.md), 2.5. Um item adiado não segura a fase em `[~]`.

Lista única do que **agente nenhum pode testar**: precisa de conta real, credencial de desenvolvedor, envio real, disco sincronizado real, segundo computador ou FFmpeg real. Nada aqui foi executado. Marque `[x]` ao conferir e anote o resultado ao lado.

Enquanto houver item aberto numa fase, ela fica `[~]` no [README](./README.md).

Legenda de quem precisa do quê:

- **[PC]** só o computador do dono, com o app rodando.
- **[Drive]** uma pasta num disco sincronizado de verdade.
- **[2 PCs]** dois computadores apontando para a mesma pasta.
- **[Google]** conta Google e projeto no Google Cloud.
- **[TikTok]** conta de desenvolvedor do TikTok.

## Fase 1 — Marca d'água

- [ ] **[PC] Renderização real com marca d'água**, com NVENC. O vídeo sai com a imagem no lugar, no tamanho e na transparência escolhidos.
- [ ] **[PC] Caminho de CPU.** Forçar a queda para `libx264` e conferir que a marca aparece igual.
- [ ] **[PC] Imagem estática pelo corte inteiro.** A marca fica do primeiro ao último quadro, sem sumir e sem esticar a duração do vídeo. Se sumir ou se o vídeo ficar mais longo, usar a alternativa de `architecture.md`, 11.4 (`-loop 1` + `shortest=1`).
- [ ] **[PC] Com `trim_internal_silence` ligado**, a duração do corte continua correta.
- [ ] **[PC] Cada modo de enquadramento** (`auto_reframe`, `split_podcast`, `crop`, `zoom`, `blur`) com marca d'água.
- [ ] **[PC] Por cima da legenda.** Com a marca na parte de baixo, ver se ela cobre a legenda de um jeito aceitável.
- [ ] **[PC] PNG com transparência, JPEG e WebP.** As bordas do PNG ficam limpas.
- [ ] **[PC] Tempo de renderização** com e sem marca. Anotar a diferença.
- [ ] **[PC] Posição padrão.** Publicar (ou abrir no celular) um corte com a marca no canto superior direito e ver se a interface do YouTube Shorts e do TikTok cobre a marca. A spec não verificou isso. Ajustar o padrão se cobrir.
- [ ] **[PC] A prévia das Configurações** bate com o resultado real, o suficiente para o usuário não se surpreender.
- [ ] **[PC] Modo "Perguntar antes"** em "Gerar cortes", em "Renderizar aprovados" e num lote.

## Fase 2 — Pasta portátil

- [ ] **[PC] Seletor de pasta nativo** (entrega opcional O3) abre no Windows, devolve o caminho e não trava o app se o usuário demorar: com a janela aberta, o resto do app continua respondendo.
- [ ] **[PC] Biblioteca que já existia.** Depois de atualizar, os cortes antigos aparecem como antes, cada pasta ganhou o seu `video.info.json` e cada corte antigo tem entrada nele.
- [ ] **[PC] Aplicativo dentro do Drive.** Com o app instalado dentro de uma pasta sincronizada, tentar escolher como raiz uma pasta que contém o app: é recusado. Abrir o app e conferir o aviso de "pasta do aplicativo parece sincronizada".
- [ ] **[Drive] O palpite `looks_synced`.** Para cada programa de sincronização em uso, anotar o caminho real da pasta e conferir que o aviso aparece. Acrescentar à lista de `architecture.md`, 8.4, o que faltar.
- [ ] **[Drive] Criar a raiz** dentro do Google Drive para computador. Anotar o modo (espelhamento ou streaming).
- [ ] **[Drive] Escrita atômica.** Durante uso normal, olhar o log por falhas de `os.replace`. Quantas novas tentativas são necessárias? Algum `.tmp` foi enviado para a nuvem?
- [ ] **[Drive] Arquivos grandes.** Baixar um vídeo de mais de 1 GB: ele chega inteiro à pasta, sem o Drive enviar um arquivo pela metade.
- [ ] **[Drive] Renderização** com o original dentro do Drive: tempo comparado com disco local.
- [ ] **[Drive] Arquivo "só na nuvem".** Com um vídeo sem cópia local, tentar assistir e renderizar. O que acontece? A mensagem é compreensível?
- [ ] **[Drive + 2 PCs] Arquivo que chega pela metade.** No segundo computador, abrir o app enquanto a pasta ainda sincroniza. Vídeos cujo arquivo ainda não chegou aparecem como "Ainda não chegou" (e não como "apagado"), sem botão de baixar de novo; depois que chegam, voltam ao normal sozinhos. Algum `video.info.json` chegou ilegível? O app o deixou intacto e mostrou o aviso?
- [ ] **[Drive + 2 PCs] Vídeo que chega antes das informações.** No segundo computador, alguma pasta apareceu com o vídeo e ainda sem `video.info.json`? O app **não** criou um arquivo de informações para ela: a pasta entrou em "pastas ainda não reconhecidas" (Configurações → Pasta) e saiu de lá sozinha quando o arquivo chegou, com "manter" e o histórico de publicações do primeiro computador. Anotar quanto tempo isso leva; se passar de 10 minutos com frequência, o prazo de `architecture.md`, 8.3, precisa subir.
- [ ] **[Drive + 2 PCs] Renomear em um computador.** Renomear um vídeo no primeiro e olhar o segundo durante a sincronização: os dois nomes de pasta aparecem ao mesmo tempo? O segundo não trocou o identificador de nenhuma das duas, e no fim sobrou um vídeo só, com o mesmo job.
- [ ] **[Drive] Nome das cópias de conflito.** Forçar um conflito (editar o mesmo `video.info.json` em dois computadores sem internet e reconectar). Anotar o nome que o Drive dá à cópia e conferir que a regra de `architecture.md`, 6.4, a reconhece. Repetir no OneDrive e no Dropbox, se forem usados.
- [ ] **[2 PCs] Abrir a mesma raiz no segundo computador.** Mesmos vídeos, mesmos cortes, mesmos títulos, mesma marca d'água, mesmas preferências. Nenhum vídeo duplicado.
- [ ] **[2 PCs] Estado em andamento.** No segundo computador o vídeo aparece como baixado; refazer o processamento funciona.
- [ ] **[2 PCs] Trava.** Com o app aberto no primeiro, abrir no segundo: entra em somente leitura. Medir quanto tempo leva para a trava aparecer do outro lado.
- [ ] **[2 PCs] "Usar neste computador".** O primeiro percebe e vira somente leitura. Em quanto tempo?
- [ ] **[2 PCs] Trava abandonada.** Fechar o primeiro à força; depois de 10 minutos o segundo mostra "O outro computador parece parado" e **só assume com o clique** em "Usar aqui".
- [ ] **[2 PCs] Sincronização pausada.** Com o primeiro trabalhando, pausar a sincronização do segundo por 15 minutos: o segundo mostra "parece parado" e **não** assume sozinho; o primeiro continua dono.
- [ ] **[2 PCs] Perder a pasta no meio.** Com uma renderização longa no primeiro, clicar em "Usar neste computador" no segundo: a renderização termina, o corte aparece nos dois, e nada novo começa no primeiro.
- [ ] **[2 PCs] Dois escrevendo.** Forçar os dois a acharem que são donos (sem internet) e, em cada um, gerar um corte do mesmo vídeo e marcar "manter". Depois de reconectar: os dois cortes e a marca estão lá.
- [ ] **[2 PCs] Relógios diferentes.** Adiantar o relógio de um computador em 15 minutos e repetir os testes de trava.
- [ ] **[2 PCs] Sistemas diferentes** (Windows e Linux ou macOS), se houver: nomes de pasta com acento nos vídeos antigos.
- [ ] **[PC] Migração real** dos vídeos existentes, no mesmo disco e para outro disco. Conferir que nada sumiu da origem no segundo caso.
- [ ] **[PC] Migração interrompida** (fechar o app no meio de um vídeo grande, uma vez no mesmo disco e uma vez para outro disco) e refeita. Depois de "Continuar": o vídeo interrompido está **numa pasta só** no destino, não existe `<nome> (2)`, nenhum arquivo foi copiado duas vezes, e na lista aparece um vídeo só.
- [ ] **[PC] Pasta indisponível.** Fechar o Drive ou desconectar o disco e abrir o app: aparece o diálogo; nada é criado no caminho; "Tentar de novo" funciona depois de reconectar.
- [ ] **[PC] Migração com arquivados.** Com um vídeo ativo e um arquivado de mesmo nome: os dois chegam à raiz separados, o arquivado continua arquivado.
- [ ] **[PC] Voltar para o modo local** e conferir que os vídeos antigos (se não foram movidos) reaparecem, e que a confirmação diz onde ficaram os que foram movidos.
- [ ] **[PC] Caminho longo.** A validação recusa raiz com mais de 75 caracteres no Windows. Com uma raiz de 70 caracteres e um vídeo de título bem longo (a pasta é cortada em 80): baixar, renderizar e publicar funcionam? O FFmpeg e o programa de sincronização aguentam esse comprimento? Se aguentarem bem mais, o limite pode subir.
- [ ] **[PC] Renomear um vídeo para `..`** (e para um nome reservado, como `CON`): o app recusa ou ajusta, e nada sai do lugar.
- [ ] **[PC] Renomear um vídeo para o nome de outro vídeo** (igual e só com maiúsculas trocadas), para `_archived` e, sem pasta escolhida, para `logs`: o app responde "Escolha outro nome.", nenhuma pasta vai parar dentro de outra, e remover o vídeo depois apaga só ele.
- [ ] **[PC] Escolher como pasta** a pasta Documentos inteira, a Área de Trabalho, `C:\Users` e uma subpasta da pasta que já está em uso: todas recusadas, com texto compreensível. `Documentos\Cortes` é aceita. Se Documentos estiver redirecionada para o OneDrive com outro nome de pasta, anotar o caminho real.
- [ ] **[Drive] Arquivar um vídeo** em modo raiz quando já existe um arquivado com o mesmo nome: a rota atual apaga o destino antes de mover (`videos.py:187-189`). Confirmar o efeito no outro computador e decidir se isso precisa de correção.

## Fase 3 — Perfis e contas

- [ ] **[PC] Cofre do Windows.** Com a plataforma falsa de desenvolvimento, conectar uma conta e conferir que a entrada aparece no Gerenciador de Credenciais e que nenhum arquivo contém o valor.
- [ ] **[PC] Tamanho máximo de uma entrada** no cofre do Windows. A spec não verificou o limite. Conferir que um token de renovação real do Google e um do TikTok cabem.
- [ ] **[PC] Reiniciar o computador** e conferir que a conta continua conectada.
- [ ] **[PC] Outro usuário do Windows** no mesmo computador não enxerga o login.
- [ ] **[PC] Linux ou macOS**, se forem usados: há cofre disponível? Se não, a tela avisa e o login vale só até fechar. No Linux com o cofre bloqueado: o app não trava esperando a senha.
- [ ] **[PC] Nome do backend do cofre.** Anotar o nome da classe que a biblioteca `keyring` usa neste Windows e conferir que está na lista fixa do adaptador.
- [ ] **[PC] Console do navegador.** Com as ferramentas de desenvolvedor abertas, salvar uma credencial de aplicativo: o valor não aparece no console.
- [ ] **[2 PCs] Perfis** criados num computador aparecem no outro; cada um pode ficar num perfil ativo diferente.
- [ ] **[PC] Trocar de perfil** troca os vídeos, a marca d'água e as preferências de corte.
- [ ] **[PC] Busca manual por segredo:** procurar o valor do token de teste em toda a raiz e em `data/`.

## Fase 4 — Limpeza

- [ ] **[PC] Exclusão real** num conjunto de vídeos de teste: só o que foi marcado some; o registro bate com o que sumiu.
- [ ] **[PC] Arquivo em uso.** Com um vídeo aberto em outro programa, tentar apagar: o item volta como não apagado e a mensagem é clara.
- [ ] **[Drive] Exclusão em pasta sincronizada.** O arquivo some no outro computador? Vai para a lixeira do Drive? Por quanto tempo? Ajustar o texto do aviso se necessário.
- [ ] **[Drive] Arquivo preso pelo programa de sincronização** durante a exclusão.
- [ ] **[Drive] Arquivo "só na nuvem" na limpeza.** Um vídeo sem cópia local aparece na lista e pode ser apagado (a conferência de "link ou junção" não o recusa). Anotar, para cada programa de sincronização, se isso vale.
- [ ] **[2 PCs] "Manter" que ainda não chegou.** Marcar "manter" num computador e, antes de sincronizar, abrir a lista de limpeza no outro: o aviso da lista é claro o bastante?
- [ ] **[2 PCs] Registro de exclusões.** Apagar algo em cada computador: aparecem dois arquivos em `limpeza/`, nenhuma cópia de conflito, e o histórico mostra as duas exclusões.
- [ ] **[PC] Relógio errado.** Adiantar o relógio em um mês: o que a lista sugere? As datas e idades mostradas deixam o erro visível?
- [ ] **[2 PCs] Depois de apagar num computador,** o outro mostra "Original apagado" e os cortes, sem erro.
- [ ] **[Drive + 2 PCs] Limpeza de um vídeo que ainda não chegou inteiro.** No segundo computador, com o original de um vídeo ainda "não chegou", apagar pela limpeza os cortes dele que já chegaram: o vídeo continua na lista, o `video.info.json` continua na pasta e, quando o original chega, é o **mesmo** vídeo, com "manter" e o histórico de publicações intactos.
- [ ] **[PC] Tamanho estimado do `yt-dlp`.** Em 10 links variados, quantas vezes o tamanho vem antes do download? Quão perto fica do tamanho real?
- [ ] **[PC] Vídeo maior que o limite,** com tamanho conhecido e com tamanho desconhecido.
- [ ] **[PC] Adiar.** O aviso some e volta no dia seguinte.
- [ ] **[PC] Tempo de varredura** com a biblioteca real (centenas de vídeos), em disco local e no Drive.
- [ ] **[PC] "Baixar de novo"** (entrega opcional O2) depois de apagar o original de um vídeo do YouTube.
- [ ] **[PC] "Apagar este vídeo"** no diálogo de vídeo acima do limite: só o original some, o histórico registra "por você", e um arquivo estranho posto à mão na pasta do vídeo continua lá.
- [ ] **[PC] A pílula de aviso** aparece com a barra lateral escondida e não atrapalha o modo imersivo.
- [ ] **[PC] Um leigo entende a lista?** Mostrar a tela a alguém que não conhece o app e pedir que diga o que vai acontecer ao clicar em "Apagar".

## Fase 5 — YouTube

Antes: o passo zero da fase (leitura das páginas) feito por quem implementa.

**Preparar**

- [ ] **[Google] Seguir o passo a passo** de `platforms.md`, seção 3, do zero. Anotar cada ponto em que os nomes dos menus são diferentes do texto e corrigir o texto.
- [ ] **[Google] Custo.** Em nenhum momento o Google pede cartão ou cobra.
- [ ] **[Google] Importar o arquivo `.json`** baixado do console funciona.

**Entrar**

- [ ] **[Google] Login completo:** o navegador abre, o Google mostra a tela de consentimento (com o aviso de aplicativo não verificado), o retorno em `127.0.0.1` funciona e a aba mostra "Conta conectada".
- [ ] **[Google] O literal `127.0.0.1`** é aceito como retorno (a documentação diz "loopback IP address").
- [ ] **[Google] Escopo.** Só com `youtube.upload`, `channels.list?mine=true` responde? Se não, qual escopo a mais é preciso?
- [ ] **[Google] `youtube.upload` aparece como "sensível"** no console?
- [ ] **[Google] Conta com mais de um canal ou conta de marca:** qual canal vem? Dá para escolher? O app mostra o canal certo?
- [ ] **[Google] Vencimento em 7 dias.** Esperar 8 dias com o aplicativo em "Testing" e tentar publicar: o app pede para entrar de novo, sem erro feio.
- [ ] **[Google] Publicar o aplicativo no próprio projeto** ("In production") e repetir: o login ainda vence em 7 dias?
- [ ] **[Google + 2 PCs] Segundo computador:** importar o mesmo arquivo, entrar, e conferir que a conta é reconhecida como a mesma (mesmo ID de canal).
- [ ] **[Google] Entrar com a conta errada** ao reconectar: o app recusa e explica.
- [ ] **[Google] Sair:** o acesso do app some da página de permissões da conta Google.
- [ ] **[Google] Sair com dois canais do mesmo login** conectados: o outro canal continua conectado ou cai? (Não confirmado; o app avisa antes e confere depois.) Anotar o resultado em `platforms.md`.
- [ ] **[Google] Revogação com o token no corpo do pedido** é aceita? Se só funcionar com o token na URL, registrar em `decisions.md` e conferir que a URL não aparece em nenhum log.

**Publicar**

- [ ] **[Google] Primeiro envio, como "Privado".** O vídeo aparece no YouTube Studio, privado, com título e descrição certos.
- [ ] **[Google] É um Short?** O vídeo vertical de menos de 3 minutos aparece na aba de Shorts do canal.
- [ ] **[Google] Envio como "Público" por projeto novo e não verificado: fica público?** É a pergunta mais importante desta lista (a documentação da API e a Central de Ajuda se contradizem). Anotar o resultado e a data.
- [ ] **[Google] Se ficou privado:** dá para tornar público depois no Studio?
- [ ] **[Google] A privacidade mostrada pelo app** depois do envio é a que o YouTube aplicou.
- [ ] **[Google] "Feito para crianças"** enviado pela API aparece assim no Studio.
- [ ] **[Google] Hashtags** no fim da descrição funcionam como hashtags.
- [ ] **[Google] Título longo e descrição longa:** onde a API recusa? A mensagem do app é compreensível?
- [ ] **[Google] `categoryId` padrão** é aceito.
- [ ] **[Google] O link** gravado pelo app abre o vídeo.
- [ ] **[Google] Queda de internet no meio do envio:** o app retoma do ponto em que parou.
- [ ] **[Google] Fechar o app no meio do envio:** ao reabrir, o envio está "Interrompido" e "Retomar" funciona (ou recomeça, se a sessão venceu). Nenhum vídeo pela metade aparece no canal.
- [ ] **[Google] Cancelar no meio:** nenhum vídeo aparece no canal.
- [ ] **[Google] Cortar a internet no último instante do envio** (ou fechar o app logo depois de 100%): ao voltar, o app descobre sozinho que o vídeo foi publicado, ou mostra "sem confirmação". Em nenhum caso reenvia sozinho; o canal fica com **um** vídeo.
- [ ] **[Google] Quanto tempo vale uma sessão de envio?** Pausar um envio e retomar depois de 1 hora, 1 dia e 1 semana.
- [ ] **[Google] Corte antigo** (gerado antes desta atualização): dá para publicar; o título vem vazio se não havia título guardado.
- [ ] **[Google] Publicar o mesmo corte duas vezes:** o app avisa antes.
- [ ] **[Google + 2 PCs] Publicar no primeiro computador** e abrir o diálogo no segundo: aparece "Já publicado".
- [ ] **[Google] Contagem de envios do dia** ("neste computador") bate com o uso de cota mostrado no console quando só um computador envia.
- [ ] **[Google + 2 PCs] Mesma credencial em dois computadores:** o console soma os envios dos dois; cada app mostra só os seus; nenhum bloqueia antes da hora.
- [ ] **[Google + 2 PCs] Envio interrompido em outro computador.** Começar um envio no primeiro e desligá-lo no meio; um dia depois, no segundo, o destino mostra "Envio interrompido em <computador>" e "Liberar" permite enviar.
- [ ] **[Google] Nome do arquivo de credenciais** baixado do console: casa com `client_secret*.json`? Colocá-lo dentro da pasta dos vídeos faz o aviso aparecer?
- [ ] **[Google] Erro de cota real,** se for viável provocar: a mensagem do app está certa. A que horas a cota volta?
- [ ] **[Google] Dois canais no mesmo perfil:** o mesmo corte vai para os dois, cada um com o seu registro.

**Política (o dono decide)**

- [ ] Ler os Termos e as Políticas para Desenvolvedores do YouTube e confirmar que "cada usuário com o próprio projeto" é aceitável para o uso pretendido. A spec não é aconselhamento jurídico.
- [ ] Decidir se guardar nome e foto do canal na pasta sincronizada respeita a regra de não guardar dados por tempo indefinido (P18).

## Fase 6 — TikTok

**Portão (antes do código)**

- [ ] **[TikTok] Criar a conta de desenvolvedor e o aplicativo** com a plataforma "Desktop". Anotar tudo o que o formulário pede e quanto tempo levou.
- [ ] **[TikTok] Endereço de retorno** com porta curinga: que grafia o formulário aceita?
- [ ] **[TikTok] Revisão do aplicativo:** foi aprovado? Em quanto tempo? Os escopos `user.info.basic` e `video.upload` foram concedidos?
- [ ] **[TikTok] Existe um modo de teste** antes da revisão? O que ele permite?
- [ ] **[TikTok] O segredo do aplicativo** é exigido na troca de código de um aplicativo de computador?
- [ ] **[TikTok] Rascunho com aplicativo não auditado:** o envio para a caixa de entrada é aceito? O rascunho aparece no app do TikTok? Dá para postar para o público a partir dele, com a conta pública? **É a pergunta que decide a fase.**

**Depois de implementado**

- [ ] **[TikTok] Login completo** pelo app, com PKCE em hexadecimal.
- [ ] **[TikTok] Renovação do token** depois de 2 horas; o token de renovação novo é o que fica guardado.
- [ ] **[TikTok] Envio de um corte como rascunho** pelo app; a notificação chega; a postagem é concluída no celular.
- [ ] **[TikTok] Quanto tempo vale a `upload_url`?**
- [ ] **[TikTok] Sexto rascunho pendente em 24 horas:** o erro aparece com a mensagem certa.
- [ ] **[TikTok] Renovação no meio do uso:** com o token de acesso vencido, abrir o diálogo de publicar enquanto um envio está na fila: a conta não cai para "entrar de novo".
- [ ] **[TikTok] [só com O1] Publicação direta com conta privada:** sai como "Só eu", e a pílula diz isso.
- [ ] **[TikTok] [só com O1] Publicação direta com conta pública:** o erro `unaudited_client_can_only_post_to_private_accounts` aparece com a mensagem do app.
- [ ] **[TikTok] [só com O1] As opções de privacidade e de interação** mostradas pelo app batem com as da conta.
- [ ] **[TikTok] Corte vertical 1080×1920** é aceito sem ajuste.
- [ ] **[TikTok + 2 PCs] Segundo computador,** com o mesmo aplicativo: a conta é reconhecida (mesmo `open_id`).
- [ ] **[TikTok] Com outro aplicativo:** o app explica que o identificador mudou, em vez de criar uma conta duplicada.
- [ ] **[TikTok] A frase de consentimento:** existe redação oficial em português?
- [ ] **[TikTok] Sair** revoga o acesso (conferir nas configurações da conta do TikTok).

## Pendências que não são teste

- [ ] Responder às perguntas P1 a P23 do [README](./README.md) e dizer quais entregas opcionais (O1 a O4) entram.
- [ ] Reabrir no navegador as páginas oficiais citadas em [platforms.md](./platforms.md) e conferir as citações literais, antes de qualquer texto de tela baseado nelas.
- [ ] Decidir o que fazer com `data/settings.json` versionado no git com o caminho do usuário dentro (fora do escopo desta spec; ver `architecture.md`, seção 15).
