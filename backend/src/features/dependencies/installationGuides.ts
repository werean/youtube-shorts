/**
 * Dependency installation instructions and utilities.
 */

import type { InstallationGuide } from "@youtube-shorts/contracts";

export const INSTALLATION_GUIDES: Record<string, InstallationGuide> = {
  python: {
    name: "Python",
    manual: {
      title: "Instalação Manual do Python",
      description:
        "Python é necessário para executar Whisper e PyTorch. Recomenda-se Python 3.10 ou superior.",
      steps: [
        "1. Acesse https://www.python.org/downloads/",
        "2. Baixe a versão mais recente (3.11 ou superior recomendado)",
        "3. Execute o instalador e marque 'Add Python to PATH'",
        "4. Clique em 'Install Now'",
        "5. Abra um novo terminal e verifique com: python --version",
      ],
      links: [{ text: "Download Python", url: "https://www.python.org/downloads/" }],
    },
    automatic: {
      command: "choco install python -y",
      description:
        "Usa Chocolatey para instalar Python automaticamente (requer Chocolatey instalado)",
    },
  },
  whisper: {
    name: "Whisper",
    manual: {
      title: "Instalação Manual do Whisper",
      description: "Whisper é usado para transcrição de áudio. Requer Python instalado.",
      steps: [
        "1. Abra um terminal/PowerShell",
        "2. Execute: pip install -U openai-whisper",
        "3. Para suporte GPU CUDA, execute também: pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118",
        "4. Verifique a instalação com: whisper --help",
      ],
      links: [{ text: "Documentação Whisper", url: "https://github.com/openai/whisper" }],
    },
    automatic: {
      command: "pip install -U openai-whisper",
      description: "Instala Whisper via pip",
    },
  },
  ytdlp: {
    name: "yt-dlp",
    manual: {
      title: "Instalação Manual do yt-dlp",
      description: "yt-dlp é usado para download/ingest de vídeos do YouTube e outras plataformas.",
      steps: [
        "1. Abra um terminal/PowerShell",
        "2. Execute: pip install -U yt-dlp",
        "3. Verifique a instalação com: yt-dlp --version",
      ],
      links: [
        {
          text: "yt-dlp - instalação oficial",
          url: "https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#installation",
        },
      ],
    },
    automatic: {
      command: "pip install -U yt-dlp",
      description: "Instala yt-dlp via pip",
    },
  },
  ffmpeg: {
    name: "FFmpeg",
    manual: {
      title: "Instalação Manual do FFmpeg",
      description:
        "FFmpeg é necessário para processar vídeos. Você pode baixar a build essentials.",
      steps: [
        "1. Acesse https://www.gyan.dev/ffmpeg/builds/",
        "2. Baixe 'ffmpeg-git-essentials.7z' (versão essentials)",
        "3. Extraia para uma pasta (ex: C:\\ffmpeg)",
        "4. Adicione a pasta ao PATH do Windows:",
        "   - Abra 'Variáveis de Ambiente'",
        "   - Em 'Variáveis do sistema', clique em 'Path' e 'Editar'",
        "   - Clique 'Novo' e adicione C:\\ffmpeg\\bin",
        "5. Abra um novo terminal e verifique com: ffmpeg -version",
      ],
      links: [{ text: "FFmpeg Builds", url: "https://www.gyan.dev/ffmpeg/builds/" }],
    },
    automatic: {
      command: "winget install Gyan.FFmpeg",
      description: "Instala FFmpeg via winget",
    },
  },
  cuda: {
    name: "CUDA",
    manual: {
      title: "Instalação Manual do CUDA",
      description:
        "Para a maioria dos usuários, o NVIDIA App já instala e mantém os componentes necessários de driver/CUDA automaticamente.",
      steps: [
        "1. Instale o NVIDIA App pelo link oficial",
        "2. Abra o NVIDIA App e atualize para o driver recomendado mais recente",
        "3. Reinicie o computador, se solicitado",
        "4. Verifique no terminal com: nvidia-smi",
      ],
      links: [
        {
          text: "NVIDIA App (oficial)",
          url: "https://www.nvidia.com/pt-br/software/nvidia-app/",
        },
      ],
    },
  },
  pytorch: {
    name: "PyTorch",
    manual: {
      title: "Instalação Manual do PyTorch",
      description:
        "PyTorch é a biblioteca de machine learning necessária para Whisper e modelos de IA.",
      steps: [
        "1. Acesse https://pytorch.org/get-started/locally/",
        "2. Selecione as opções:",
        "   - PyTorch Build: Stable",
        "   - OS: Windows",
        "   - Package: pip",
        "   - Language: Python",
        "   - Compute Platform: CUDA 12.1 (RTX 4000 ou inferior) ou Nightly CUDA 12.8 (RTX 5000 series)",
        "3. Copie o comando gerado.",
        "   - RTX 4000 ou inferior: pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121",
        "   - RTX 5000 series: pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128",
        "4. Abra terminal e execute o comando",
        '5. Verifique com: python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.is_available())"',
      ],
      links: [{ text: "PyTorch Get Started", url: "https://pytorch.org/get-started/locally/" }],
    },
    automatic: {
      command:
        "pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121",
      description:
        "Instala PyTorch com suporte CUDA 12.1 (RTX 4000 ou inferior). Para RTX 5000, use Nightly CUDA 12.8.",
    },
  },
  ollama: {
    name: "Ollama",
    manual: {
      title: "Instalação Manual do Ollama",
      description:
        "Ollama permite executar modelos de linguagem localmente. É necessário para análise e processamento de IA.",
      steps: [
        "1. Acesse https://ollama.com/download",
        "2. Clique em 'Download for Windows'",
        "3. Execute o instalador (.exe) que foi baixado",
        "4. Siga as instruções de instalação",
        "5. Após instalar, Ollama será iniciado automaticamente em http://localhost:11434",
        "6. Abra um novo terminal/PowerShell e verifique com: ollama --version",
        "7. Para baixar um modelo padrão, execute: ollama pull llama2 (ou outro modelo desejado)",
      ],
      links: [
        { text: "Ollama - Download Windows", url: "https://ollama.com/download" },
        { text: "Ollama - Modelos disponíveis", url: "https://ollama.com/library" },
        { text: "Ollama - Documentação", url: "https://github.com/ollama/ollama" },
      ],
    },
  },
};
