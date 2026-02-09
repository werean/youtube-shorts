import { useState, useMemo } from "react";
import type { ActionState } from "../hooks/useAppAction";
import { WHISPER_MODELS, WHISPER_LANGUAGES, WHISPER_OUTPUT_FORMATS } from "../types/whisper";
import type { WhisperConfig } from "../types/whisper";
import {
  ConfigField,
  TextInput,
  TextArea,
  SelectInput,
  Toggle,
  MultiSelect,
  ConfigSection,
} from "./WhisperConfigComponents";
import { generateWhisperCommand } from "../utils/whisperCommandBuilder";

interface WhisperConfigDialogProps {
  whisperDevice: "cpu" | "cuda";
  whisperFormats: string[];
  action: ActionState;
  initialConfig?: Partial<WhisperConfig>;
  onSave: (config: Partial<WhisperConfig>) => void;
  onCancel: () => void;
}

export function WhisperConfigDialog({
  whisperDevice: initialDevice,
  whisperFormats: initialFormats,
  action,
  initialConfig,
  onSave,
  onCancel,
}: WhisperConfigDialogProps) {
  // Model options
  const [model, setModel] = useState<string>(initialConfig?.model || "large-v3");

  // Device & Output
  const [device, setDevice] = useState<"cpu" | "cuda">(
    (initialConfig?.device as "cpu" | "cuda") || initialDevice,
  );
  const [formats, setFormats] = useState<string[]>(
    Array.isArray(initialConfig?.output_format) ? initialConfig!.output_format : initialFormats,
  );

  // Basic options
  const [verbose, setVerbose] = useState<boolean | undefined>(initialConfig?.verbose);
  const [task, setTask] = useState<"transcribe" | "translate">(initialConfig?.task || "transcribe");
  const [language, setLanguage] = useState<string>(initialConfig?.language || "");
  const [temperature, setTemperature] = useState<string>(
    initialConfig?.temperature ? String(initialConfig.temperature) : "",
  );

  // Search & Sampling
  const [best_of, setBest_of] = useState<string>(
    initialConfig?.best_of ? String(initialConfig.best_of) : "",
  );
  const [beam_size, setBeam_size] = useState<string>(
    initialConfig?.beam_size ? String(initialConfig.beam_size) : "",
  );
  const [patience, setPatience] = useState<string>(
    initialConfig?.patience ? String(initialConfig.patience) : "",
  );
  const [length_penalty, setLength_penalty] = useState<string>(
    initialConfig?.length_penalty ? String(initialConfig.length_penalty) : "",
  );

  // Token & Prompt
  const [suppress_tokens, setSuppress_tokens] = useState<string>(
    initialConfig?.suppress_tokens ? String(initialConfig.suppress_tokens) : "",
  );
  const [initial_prompt, setInitial_prompt] = useState<string>(
    initialConfig?.initial_prompt ? String(initialConfig.initial_prompt) : "",
  );
  const [carry_initial_prompt, setCarry_initial_prompt] = useState<boolean | undefined>(
    initialConfig?.carry_initial_prompt,
  );
  const [condition_on_previous_text, setCondition_on_previous_text] = useState<boolean | undefined>(
    initialConfig?.condition_on_previous_text,
  );

  // Advanced Decoding
  const [fp16, setFp16] = useState<boolean | undefined>(initialConfig?.fp16);
  const [temperature_increment, setTemperature_increment] = useState<string>(
    initialConfig?.temperature_increment_on_fallback
      ? String(initialConfig.temperature_increment_on_fallback)
      : "",
  );
  const [compression_ratio_threshold, setCompression_ratio_threshold] = useState<string>(
    initialConfig?.compression_ratio_threshold
      ? String(initialConfig.compression_ratio_threshold)
      : "",
  );
  const [logprob_threshold, setLogprob_threshold] = useState<string>(
    initialConfig?.logprob_threshold ? String(initialConfig.logprob_threshold) : "",
  );
  const [no_speech_threshold, setNo_speech_threshold] = useState<string>(
    initialConfig?.no_speech_threshold ? String(initialConfig.no_speech_threshold) : "",
  );

  // Timestamp & Word options
  const [word_timestamps, setWord_timestamps] = useState(Boolean(initialConfig?.word_timestamps));
  const [prepend_punctuations, setPrepend_punctuations] = useState<string>(
    initialConfig?.prepend_punctuations ? String(initialConfig.prepend_punctuations) : "",
  );
  const [append_punctuations, setAppend_punctuations] = useState<string>(
    initialConfig?.append_punctuations ? String(initialConfig.append_punctuations) : "",
  );
  const [highlight_words, setHighlight_words] = useState(Boolean(initialConfig?.highlight_words));

  // Output formatting
  const [max_line_width, setMax_line_width] = useState<string>(
    initialConfig?.max_line_width ? String(initialConfig.max_line_width) : "",
  );
  const [max_line_count, setMax_line_count] = useState<string>(
    initialConfig?.max_line_count ? String(initialConfig.max_line_count) : "",
  );
  const [max_words_per_line, setMax_words_per_line] = useState<string>(
    initialConfig?.max_words_per_line ? String(initialConfig.max_words_per_line) : "",
  );

  // Performance
  const [threads, setThreads] = useState<string>(
    initialConfig?.threads ? String(initialConfig.threads) : "",
  );
  const [clip_timestamps, setClip_timestamps] = useState<string>(
    initialConfig?.clip_timestamps ? String(initialConfig.clip_timestamps) : "",
  );
  const [hallucination_silence_threshold, setHallucination_silence_threshold] = useState<string>(
    initialConfig?.hallucination_silence_threshold
      ? String(initialConfig.hallucination_silence_threshold)
      : "",
  );

  // UI State
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleFormatsChange = (newFormats: string[]) => {
    // Se "all" foi clicado e não estava marcado, marcar todos os outros
    if (newFormats.includes("all") && !formats.includes("all")) {
      setFormats(["all", "txt", "vtt", "srt", "tsv", "json"]);
    }
    // Se "all" foi desmarcado, remover todos
    else if (!newFormats.includes("all") && formats.includes("all")) {
      // Remover "all" e manter apenas os outros que foram marcados
      setFormats(newFormats.filter((f) => f !== "all"));
    }
    // Se qual quer outro foi clicado
    else if (!newFormats.includes("all")) {
      // Se ficou vazio, não permitir (manter pelo menos um)
      if (newFormats.length === 0) {
        // Manter o estado anterior
        return;
      }
      // Se foram marcados todos os outros, marcar "all" também
      const allFormatsExceptAll = ["txt", "vtt", "srt", "tsv", "json"];
      if (allFormatsExceptAll.every((f) => newFormats.includes(f))) {
        setFormats([...newFormats, "all"]);
      } else {
        setFormats(newFormats);
      }
    } else {
      setFormats(newFormats);
    }
  };

  const handleSave = () => {
    const config: Partial<WhisperConfig> = {
      model: model as "turbo" | "large-v3" | "large" | "medium" | "small" | "base" | "tiny",
      device: device as "cpu" | "cuda",
      output_format: formats as any,
      verbose,
      task,
      language: language || undefined,
      temperature: temperature || undefined,
      best_of: best_of || undefined,
      beam_size: beam_size || undefined,
      patience: patience ? parseFloat(patience) : undefined,
      length_penalty: length_penalty ? parseFloat(length_penalty) : undefined,
      suppress_tokens: suppress_tokens || undefined,
      initial_prompt: initial_prompt || undefined,
      carry_initial_prompt,
      condition_on_previous_text,
      fp16,
      temperature_increment_on_fallback: temperature_increment || undefined,
      compression_ratio_threshold: compression_ratio_threshold || undefined,
      logprob_threshold: logprob_threshold || undefined,
      no_speech_threshold: no_speech_threshold || undefined,
      word_timestamps,
      prepend_punctuations: prepend_punctuations || undefined,
      append_punctuations: append_punctuations || undefined,
      highlight_words,
      max_line_width: max_line_width ? parseInt(max_line_width) : undefined,
      max_line_count: max_line_count ? parseInt(max_line_count) : undefined,
      max_words_per_line: max_words_per_line ? parseInt(max_words_per_line) : undefined,
      threads: threads || undefined,
      clip_timestamps: clip_timestamps || undefined,
      hallucination_silence_threshold: hallucination_silence_threshold
        ? parseFloat(hallucination_silence_threshold)
        : undefined,
    };
    onSave(config);
  };

  // Gerar comando Whisper dinamicamente
  const whisperCommand = useMemo(() => {
    const config: Partial<WhisperConfig> = {
      model: model as "turbo" | "large-v3" | "large" | "medium" | "small" | "base" | "tiny",
      device: device as "cpu" | "cuda",
      output_format: formats as any,
      verbose,
      task,
      language: language || undefined,
      temperature,
      best_of,
      beam_size,
      patience: patience ? parseFloat(patience) : undefined,
      length_penalty: length_penalty ? parseFloat(length_penalty) : undefined,
      suppress_tokens: suppress_tokens || undefined,
      initial_prompt: initial_prompt || undefined,
      carry_initial_prompt,
      condition_on_previous_text,
      fp16,
      temperature_increment_on_fallback: temperature_increment,
      compression_ratio_threshold,
      logprob_threshold,
      no_speech_threshold,
      word_timestamps,
      prepend_punctuations: prepend_punctuations || undefined,
      append_punctuations: append_punctuations || undefined,
      highlight_words,
      max_line_width: max_line_width ? parseInt(max_line_width) : undefined,
      max_line_count: max_line_count ? parseInt(max_line_count) : undefined,
      max_words_per_line: max_words_per_line ? parseInt(max_words_per_line) : undefined,
      threads,
      clip_timestamps: clip_timestamps || undefined,
      hallucination_silence_threshold: hallucination_silence_threshold
        ? parseFloat(hallucination_silence_threshold)
        : undefined,
    };
    return generateWhisperCommand(config, ".\\Nome_Do_Seu_Video");
  }, [
    model,
    device,
    formats,
    verbose,
    task,
    language,
    temperature,
    best_of,
    beam_size,
    patience,
    length_penalty,
    suppress_tokens,
    initial_prompt,
    carry_initial_prompt,
    condition_on_previous_text,
    fp16,
    temperature_increment,
    compression_ratio_threshold,
    logprob_threshold,
    no_speech_threshold,
    word_timestamps,
    prepend_punctuations,
    append_punctuations,
    highlight_words,
    max_line_width,
    max_line_count,
    max_words_per_line,
    threads,
    clip_timestamps,
    hallucination_silence_threshold,
  ]);

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "1100px", width: "95vw" }}
      >
        <div className="dialog-header">
          <h3>🎙️ Configurar Whisper</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onCancel}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content" style={{ padding: "20px" }}>
          {/* Basic Options Section */}
          <ConfigSection title="Opções Básicas" icon="⚡">
            <ConfigField
              label="Modelo"
              description="Escolha entre modelos rápidos ou precisos"
              tooltip="Turbo é super rápido mas um pouco menos preciso. Large é mais lento mas muito mais preciso. Escolha baseado no que é mais importante para você."
            >
              <SelectInput
                value={model}
                onChange={setModel}
                options={WHISPER_MODELS.map((m) => ({ label: m.label, value: m.id }))}
              />
              {/* Model specs display */}
              {(() => {
                const selectedModel = WHISPER_MODELS.find((m) => m.id === model);
                if (selectedModel) {
                  return (
                    <div
                      style={{
                        marginTop: "12px",
                        padding: "12px",
                        backgroundColor: "#f5f5f5",
                        borderRadius: "6px",
                        fontSize: "12px",
                        lineHeight: "1.6",
                        color: "#333",
                      }}
                    >
                      <div style={{ fontWeight: "600", marginBottom: "8px" }}>
                        📊 Especificações: {selectedModel.label}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                        <div>
                          <strong>VRAM:</strong> {selectedModel.vram_required}
                        </div>
                        <div>
                          <strong>RAM:</strong> {selectedModel.ram_required}
                        </div>
                        <div>
                          <strong>Tamanho:</strong> {selectedModel.size}
                        </div>
                        <div>
                          <strong>Tempo (1h audio):</strong> {selectedModel.time_1h_audio}
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <strong>Qualidade:</strong> {"⭐".repeat(selectedModel.quality)}
                          {"☆".repeat(5 - selectedModel.quality)}
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <strong>Velocidade:</strong> {"🚀".repeat(selectedModel.speed)}
                          {"🐢".repeat(5 - selectedModel.speed)}
                        </div>
                        <div style={{ gridColumn: "1 / -1", color: "#666", fontStyle: "italic" }}>
                          <strong>Recomendado:</strong> {selectedModel.recommended_use}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </ConfigField>

            <ConfigField
              label="Tarefa"
              description="Converter fala em texto ou traduzir para inglês"
              tooltip="Transcrição: apenas converte o que está sendo falado para texto. Tradução: converte para texto em inglês mesmo que o áudio seja em outro idioma."
            >
              <SelectInput
                value={task}
                onChange={setTask as any}
                options={[
                  { label: "Transcrever", value: "transcribe" },
                  { label: "Traduzir para inglês", value: "translate" },
                ]}
              />
            </ConfigField>

            <ConfigField
              label="Idioma"
              description="Qual idioma está sendo falado (deixe vazio para detectar automaticamente)"
              tooltip="Deixe em branco e a IA tenta adivinhar automaticamente. Se souber qual é o idioma, especifique para melhorar a precisão."
            >
              <SelectInput
                value={language}
                onChange={setLanguage}
                options={WHISPER_LANGUAGES.map((lang) => ({
                  label: lang,
                  value: lang,
                }))}
              />
            </ConfigField>
          </ConfigSection>

          {/* Device & Output Section */}
          <ConfigSection title="Dispositivo e Saída" icon="💾">
            <ConfigField
              label="Dispositivo"
              description="Usar processador comum ou placa gráfica (GPU)"
              tooltip="GPU (CUDA) é muito, muito mais rápido se você tiver placa NVIDIA. Processador (CPU) é mais compatível e funciona sempre, mas é bem mais lento."
            >
              <div style={{ display: "flex", gap: "8px" }}>
                {(["cpu", "cuda"] as const).map((dev) => (
                  <button
                    key={dev}
                    onClick={() => setDevice(dev)}
                    style={{
                      flex: 1,
                      padding: "12px",
                      borderRadius: "8px",
                      border: device === dev ? "2px solid #3b82f6" : "1px solid #ccc",
                      background: device === dev ? "#e0e7ff" : "#fff",
                      cursor: "pointer",
                      fontWeight: device === dev ? "600" : "400",
                      color: device === dev ? "#3b82f6" : "#666",
                      fontSize: "14px",
                    }}
                  >
                    {dev === "cpu" ? "💻 CPU" : "🚀 CUDA"}
                  </button>
                ))}
              </div>
            </ConfigField>

            <ConfigField
              label="Formatos de saída"
              description="Quais formatos de arquivo salvar"
              tooltip="Por exemplo, pode gerar em TXT (simples), SRT (para vídeos), VTT, JSON... tudo de uma vez. Deixe marcado pelo menos um formato."
            >
              <MultiSelect
                values={formats}
                onChange={handleFormatsChange}
                options={WHISPER_OUTPUT_FORMATS as any}
              />
            </ConfigField>
          </ConfigSection>

          {/* Advanced Settings Toggle */}
          <div
            style={{
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: "1px solid #e5e7eb",
            }}
          >
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 16px",
                backgroundColor: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "14px",
                color: "#1f2937",
                width: "100%",
                justifyContent: "space-between",
              }}
            >
              <span>⚙️ Configurações Avançadas</span>
              <span
                style={{
                  transform: showAdvanced ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.3s ease",
                }}
              >
                ▼
              </span>
            </button>
          </div>

          {/* Advanced Sections */}
          {showAdvanced && (
            <>
              {/* Search & Sampling Section */}
              <ConfigSection title="Busca e Amostragem" icon="🔍">
                <ConfigField
                  label="Modo verbose"
                  description="Exibir detalhes durante a transcrição"
                  tooltip="Mostra um texto detalhado do que está acontecendo enquanto a IA processa. Útil se quiser entender o que está levando tempo."
                >
                  <Toggle checked={verbose} onChange={setVerbose} />
                </ConfigField>

                <ConfigField
                  label="Temperatura (0.0 - 1.0)"
                  description="Quanto criativo o resultado será (0 = exato, 1 = criativo)"
                  tooltip="0 = usa exatamente o que ouve, 1 = acrescenta criatividade/suposições. Padrão é 0 (bem exato). Deixe vazio para usar padrão."
                >
                  <TextInput
                    type="number"
                    value={temperature}
                    onChange={(v) => setTemperature(v)}
                    min={0}
                    max={1}
                  />
                </ConfigField>

                <ConfigField
                  label="Best of"
                  description="Gerar múltiplas tentativas e usar a melhor"
                  tooltip="Experimenta 5 formas diferentes em paralelo e escolhe a melhor. Quanto maior o número, melhor o resultado mas mais lento (5 é padrão)."
                >
                  <TextInput
                    type="number"
                    value={best_of}
                    onChange={(v) => setBest_of(v)}
                    min={1}
                  />
                </ConfigField>

                <ConfigField
                  label="Tamanho do beam"
                  description="Considerar mais caminhos para melhor precisão"
                  tooltip="Quanto mais, mais caminhos diferentes explora para buscar a melhor resposta. 5 é um bom padrão. Números maiores deixam mais preciso mas bem mais lento."
                >
                  <TextInput
                    type="number"
                    value={beam_size}
                    onChange={(v) => setBeam_size(v)}
                    min={1}
                  />
                </ConfigField>

                <ConfigField
                  label="Patience"
                  description="Quanto mais a IA deve se esforçar para encontrar a melhor escolha"
                  tooltip="Controla quanto esforço fazer ao buscar a melhor resposta. Deixe vazio para padrão (1.0) que já é bem bom."
                >
                  <TextInput
                    type="number"
                    value={patience}
                    onChange={setPatience}
                    placeholder="1.0"
                    min={0.1}
                  />
                </ConfigField>

                <ConfigField
                  label="Penalidade de comprimento"
                  description="Preferir frases mais curtas ou mais longas"
                  tooltip="Controla se prefere frases longas ou curtas. Deixe vazio para o programa decidir sozinho qual é o melhor tamanho."
                >
                  <TextInput
                    type="number"
                    value={length_penalty}
                    onChange={setLength_penalty}
                    placeholder="Padrão"
                  />
                </ConfigField>
              </ConfigSection>

              {/* Token & Prompt Section */}
              <ConfigSection title="Token e Prompt" icon="💬">
                <ConfigField
                  label="Suprimir tokens"
                  description="Ignorar certos símbolos e caracteres especiais"
                  tooltip="Use -1 para não incluir certos símbolos estranhos. Na maioria das vezes deixe como está (-1)."
                >
                  <TextInput
                    value={suppress_tokens}
                    onChange={setSuppress_tokens}
                    placeholder="-1"
                  />
                </ConfigField>

                <ConfigField
                  label="Prompt inicial"
                  description="Dar uma dica ao programa sobre o que esperar ouvir"
                  tooltip="Por exemplo, se você sabe que vai ouvir nomes específicos ou palavras coletivas, pode escrever aqui para ajudar."
                >
                  <TextArea
                    value={initial_prompt}
                    onChange={setInitial_prompt}
                    placeholder="(opcional)"
                    rows={2}
                  />
                </ConfigField>

                <ConfigField
                  label="Manter prompt inicial"
                  description="Repetir a dica a cada frase transcrita"
                  tooltip="Se ativar, repete a dica inicial em cada parágrafo. Pode ajudar a manter consistência, mas às vezes piora um pouco."
                >
                  <Toggle checked={carry_initial_prompt} onChange={setCarry_initial_prompt} />
                </ConfigField>

                <ConfigField
                  label="Condicionar em texto anterior"
                  description="Usar o que foi transcrito antes para melhorar frases futuras"
                  tooltip="Se ativar, usa frases anteriores como contexto para entender as próximas. Deixa mais consistente mas pode ampliar erros. Se desativar, cada frase é independente."
                >
                  <Toggle
                    checked={condition_on_previous_text}
                    onChange={setCondition_on_previous_text}
                  />
                </ConfigField>
              </ConfigSection>

              {/* Advanced Decoding Section */}
              <ConfigSection title="Decodificação Avançada" icon="🧠">
                <ConfigField
                  label="FP16"
                  description="Usar modo rápido (menos preciso mas mais veloz)"
                  tooltip="Modo rápido com números comprimidos. Deixa ~10% mais rápido mas 1% menos preciso. Geralmente vale a pena."
                >
                  <Toggle checked={fp16} onChange={setFp16} />
                </ConfigField>

                <ConfigField
                  label="Incremento de temperatura em fallback"
                  description="Deixar a IA mais criativa se tiver dificuldade"
                  tooltip="Se a IA fica travada em uma palavra, aumenta a criatividade para tentar uma palavra diferente. 0.2 é um bom padrão."
                >
                  <TextInput
                    type="number"
                    value={temperature_increment}
                    onChange={(v) => setTemperature_increment(v)}
                    min={0}
                    max={1}
                  />
                </ConfigField>

                <ConfigField
                  label="Limiar de compressão gzip"
                  description="Detectar quando o resultado parece incorreto"
                  tooltip="Se uma frase parecer muito estranha ou com caracteres aleatórios, a IA descarta e tenta novamente. Quanto mais alto, mais fácil descartar. 2.4 é bom padrão."
                >
                  <TextInput
                    type="number"
                    value={compression_ratio_threshold}
                    onChange={(v) => setCompression_ratio_threshold(v)}
                    min={1}
                  />
                </ConfigField>

                <ConfigField
                  label="Limiar de logprob"
                  description="Detectar quando a IA não tem certeza de uma palavra"
                  tooltip="Se a IA tem pouca confiança em uma palavra (tipo 30% certo), descarta e tenta novamente. -1.0 é bem rigoroso, deixa vazio se quiser menos rigoroso."
                >
                  <TextInput
                    type="number"
                    value={logprob_threshold}
                    onChange={(v) => setLogprob_threshold(v)}
                  />
                </ConfigField>

                <ConfigField
                  label="Limiar sem fala"
                  description="Detectar silêncios e pausas automaticamente"
                  tooltip="Se a IA acha que não há fala (tipo áudio barulho, silêncio, etc), ela marca como silêncio automaticamente. 0.6 é um bom meio termo."
                >
                  <TextInput
                    type="number"
                    value={no_speech_threshold}
                    onChange={(v) => setNo_speech_threshold(v)}
                    min={0}
                    max={1}
                  />
                </ConfigField>
              </ConfigSection>

              {/* Timestamp & Word Options Section */}
              <ConfigSection title="Timestamps e Palavras" icon="⏱️">
                <ConfigField
                  label="Timestamps de palavras"
                  description="Saber em que segundo cada palavra foi dita"
                  tooltip="Cada palavra fica com um horário (tipo: 'olá' começou em 00:05 e terminou em 00:06). Precisa de word_timestamps ativo."
                >
                  <Toggle checked={word_timestamps} onChange={setWord_timestamps} />
                </ConfigField>

                {word_timestamps && (
                  <>
                    <ConfigField
                      label="Pontuações prepend"
                      description="Símbolos para unir com palavra seguinte"
                      tooltip={`Símbolos como aspas e parénteses que começam uma palavra. Deixe como está na maioria das vezes. Padrão: "'¿([{-`}
                    >
                      <TextInput value={prepend_punctuations} onChange={setPrepend_punctuations} />
                    </ConfigField>

                    <ConfigField
                      label="Pontuações append"
                      description="Símbolos para unir com palavra anterior"
                      tooltip={`Símbolos como aspas e pontuação que terminam uma palavra. Deixe como está na maioria das vezes.`}
                    >
                      <TextInput value={append_punctuations} onChange={setAppend_punctuations} />
                    </ConfigField>

                    <ConfigField
                      label="Destacar palavras"
                      description="Sublinhar cada palavra conforme falada"
                      tooltip="Sublinha cada palavra nos arquivos SRT/VTT conforme é falada, mostrando visualmente quando cada palavra foi dita."
                    >
                      <Toggle checked={highlight_words} onChange={setHighlight_words} />
                    </ConfigField>
                  </>
                )}
              </ConfigSection>

              {/* Output Formatting Section */}
              {word_timestamps && (
                <ConfigSection title="Formatação de Saída" icon="📝">
                  <ConfigField
                    label="Largura máxima de linha"
                    description="Quebrar linha após X caracteres"
                    tooltip="Se ficar muito longo (tipo mais de 80 caracteres), quebra a linha. Deixe vazio para deixar linhas longas mesmo."
                  >
                    <TextInput
                      type="number"
                      value={max_line_width}
                      onChange={setMax_line_width}
                      placeholder="Sem limite"
                      min={20}
                    />
                  </ConfigField>

                  <ConfigField
                    label="Máximo de linhas"
                    description="Máximo de linhas por bloco"
                    tooltip="Se tiver muitas palavras, quebra para a linha seguinte. Deixe vazio para deixar tudo junto."
                  >
                    <TextInput
                      type="number"
                      value={max_line_count}
                      onChange={setMax_line_count}
                      placeholder="Sem limite"
                      min={1}
                    />
                  </ConfigField>

                  <ConfigField
                    label="Máximo de palavras por linha"
                    description="Não usar se máximo de caracteres está definido"
                    tooltip="Limita quantas palavras ficam juntas na mesma linha. Deixe vazio para deixar quantas vezes precisar."
                  >
                    <TextInput
                      type="number"
                      value={max_words_per_line}
                      onChange={setMax_words_per_line}
                      placeholder="Sem limite"
                      min={1}
                    />
                  </ConfigField>
                </ConfigSection>
              )}

              {/* Performance Section */}
              <ConfigSection title="Performance" icon="⚙️">
                <ConfigField
                  label="Threads"
                  description="Usar mais núcleos do computador para processar mais rápido"
                  tooltip="Use seu processador com mais força. 0 = deixa o computador decidir. 4 = usa 4 núcleos. Mais núcleos = mais rápido mas usa mais energia."
                >
                  <TextInput
                    type="number"
                    value={threads}
                    onChange={(v) => setThreads(v)}
                    min={0}
                  />
                </ConfigField>

                <ConfigField
                  label="Corte de timestamps"
                  description="Transcrever apenas trechos específicos do vídeo"
                  tooltip="Exemplo: 60,120 transcreve só de 1min a 2min. 0,30,60,90 transcreve de 0 a 30seg e 1min a 1min30seg. Deixe vazio para transcrever tudo."
                >
                  <TextInput
                    value={clip_timestamps}
                    onChange={setClip_timestamps}
                    placeholder="0"
                  />
                </ConfigField>

                {word_timestamps && (
                  <ConfigField
                    label="Limiar de alucinação-silêncio"
                    description="Pular silêncios longos"
                    tooltip="Se a IA fica inventando palavras em um silêncio longo, pula aquele trecho. Use valores baixos (0.5-1s) para ignorar pausas naturais."
                  >
                    <TextInput
                      type="number"
                      value={hallucination_silence_threshold}
                      onChange={setHallucination_silence_threshold}
                      placeholder="(opcional)"
                      min={0}
                    />
                  </ConfigField>
                )}
              </ConfigSection>
            </>
          )}

          {/* Command Preview */}
          <div
            style={{
              marginTop: "32px",
              padding: "16px",
              backgroundColor: "#f3f4f6",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: "600",
                color: "#666",
                marginBottom: "8px",
              }}
            >
              📋 Comando Whisper (Prévia)
            </div>
            <div
              style={{
                backgroundColor: "#1f2937",
                color: "#10b981",
                padding: "12px",
                borderRadius: "6px",
                fontFamily: "monospace",
                fontSize: "12px",
                lineHeight: "1.5",
                overflowX: "auto",
                wordBreak: "break-word",
              }}
            >
              {whisperCommand}
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "#999",
                marginTop: "8px",
                fontStyle: "italic",
              }}
            >
              Este comando será executado com a video_source ou arquivo de áudio
            </div>
          </div>

          {/* Action Buttons */}
          <div
            style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "24px" }}
          >
            <button
              onClick={handleSave}
              disabled={action.busy}
              className="primary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              ✓ Salvar Configurações
            </button>
            <button
              onClick={onCancel}
              className="secondary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
