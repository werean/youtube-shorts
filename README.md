# YouTube Shorts - Guia de Início Rápido

## 📋 Pré-requisitos

Antes de começar, você precisará ter instalado:

- **Bun** (gerenciador de pacotes e runtime JavaScript)
  - Baixe em: https://bun.sh
  - Ou instale via `npm install -g bun`

## 🚀 Primeiros Passos

### 1. Clone ou Extraia o Projeto

```bash
cd seu-caminho/youtube-shorts
```

### 2. Instale todas as Dependências

```bash
bun run install:all
```

Este comando irá:
- Instalar dependências do projeto raiz
- Instalar dependências do backend
- Instalar dependências do frontend

### 3. Execute a Aplicação em Modo Desenvolvimento

```bash
bun run dev
```

Isso irá iniciar:
- **Backend**: http://localhost:3000 (servidor Fastify)
- **Frontend**: http://localhost:5173 (aplicação Vite)

### 4. Acesse a Aplicação

Abra seu navegador e acesse:
```
http://localhost:5173
```

## 📦 Estrutura do Projeto

```
youtube-shorts/
├── backend/              # API Fastify (TypeScript)
│   ├── src/
│   │   ├── main.ts      # Entrada da aplicação
│   │   ├── api/         # Endpoints da API
│   │   ├── core/        # Configurações e utilitários
│   │   ├── models/      # Tipos de dados
│   │   ├── pipeline/    # Lógica de processamento
│   │   ├── storage/     # Gerenciamento de arquivos
│   │   ├── llm/         # Integração com LLMs
│   │   └── video/       # Processamento de vídeo
│   └── package.json
│
├── frontend/            # Interface React (TypeScript)
│   ├── src/
│   │   ├── main.tsx    # Entrada da aplicação
│   │   ├── App.tsx     # Componente principal
│   │   ├── api.ts      # Cliente HTTP
│   │   ├── types.ts    # Tipos TypeScript
│   │   └── styles.css  # Estilos globais
│   └── package.json
│
├── data/               # Dados persistentes
│   └── jobs/          # Metadados dos jobs
│
├── upload/            # Arquivos enviados pelos usuários
│
├── scripts/           # Scripts auxiliares
│
├── docs/              # Documentação do projeto
│
└── package.json       # Configuração do workspace
```

## 🔧 Comandos Disponíveis

### Desenvolvimento

```bash
# Inicia ambos (backend + frontend) em modo watch
bun run dev

# Inicia apenas o backend
bun run dev:backend

# Inicia apenas o frontend
bun run dev:frontend
```

### Build e Produção

```bash
# Compila ambos (backend + frontend)
bun run build

# Compila apenas o backend
bun run build:backend

# Compila apenas o frontend
bun run build:frontend

# Inicia a aplicação em produção
bun run start
```

## 📋 Dependências do Sistema

A aplicação irá verificar automaticamente as seguintes dependências:

- **Python** - Para processamento com Whisper
- **Whisper** - Para transcrição de áudio (instalado via pip)
- **FFmpeg** - Para processamento de vídeo
- **CUDA** (Opcional) - Para aceleração de GPU
- **PyTorch** - Para modelos de IA
- **Ollama** (Opcional) - Para modelos de IA locais

## ✅ Verificar Dependências

Ao abrir a aplicação, acesse a aba **"Configuração"** → **"Dependências"** para ver o status de cada dependência.

Se alguma der erro:
1. Clique em **"Manual"** para ver instruções de instalação
2. Ou clique em **"Automático"** para instalar automaticamente (quando disponível)

## 🐛 Solução de Problemas

### Porta já está em uso

Se a porta 3000 ou 5173 já estiver sendo usada:

```bash
# Encontre o processo usando a porta
lsof -i :3000    # Linux/Mac
netstat -ano | findstr :3000  # Windows

# Mate o processo ou use outra porta editando os arquivos de configuração
```

### Dependências Python não encontradas

```bash
# Instale manualmente as dependências Python
pip install whisper openai-whisper

# Para suporte a GPU
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

### Erro ao conectar ao backend

Verifique se:
1. O backend está rodando (deve estar em http://localhost:3000)
2. Há uma conexão de rede ativa
3. As portas não estão bloqueadas por firewall

## 📚 Documentação Adicional

- [Arquitetura da Aplicação](./docs/ARCHITECTURE.md)
- [README do Backend](./backend/README.md)
- [README do Frontend](./frontend/README.md)

## 🤝 Contribuindo

Para contribuir ao projeto:

1. Faça as alterações
2. Teste localmente com `bun run dev`
3. Commit as mudanças
4. Abra um Pull Request

## 📝 Licença

Este projeto é propriedade privada. Todos os direitos reservados.

---

**Dúvidas?** Consulte a documentação ou abra uma issue no repositório.
