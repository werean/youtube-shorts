import { AppButton, AppCheckboxField, AppDialog } from "../shared";

interface AppSupportDialogsProps {
  showTranscriptionRegenerateConfirmDialog: boolean;
  showDeleteCutConfirmDialog: boolean;
  showHowToUseDialog: boolean;
  dontAskDeleteCutAgain: boolean;
  onCloseTranscriptionRegenerateConfirm: () => void;
  onConfirmTranscriptionRegenerate: () => void;
  onCloseDeleteCutConfirm: () => void;
  onConfirmDeleteCut: () => void;
  onDontAskDeleteCutAgainChange: (value: boolean) => void;
  onCloseHowToUse: () => void;
}

export function AppSupportDialogs({
  showTranscriptionRegenerateConfirmDialog,
  showDeleteCutConfirmDialog,
  showHowToUseDialog,
  dontAskDeleteCutAgain,
  onCloseTranscriptionRegenerateConfirm,
  onConfirmTranscriptionRegenerate,
  onCloseDeleteCutConfirm,
  onConfirmDeleteCut,
  onDontAskDeleteCutAgainChange,
  onCloseHowToUse,
}: AppSupportDialogsProps) {
  return (
    <>
      {showTranscriptionRegenerateConfirmDialog && (
        <AppDialog
          title="Confirmar nova transcrição"
          onClose={onCloseTranscriptionRegenerateConfirm}
          showHeaderClose={false}
          footer={
            <div className="ds-dialog-actions">
              <AppButton variant="primary" onClick={onCloseTranscriptionRegenerateConfirm}>
                Cancelar
              </AppButton>
              <AppButton variant="secondary" onClick={onConfirmTranscriptionRegenerate}>
                Continuar
              </AppButton>
            </div>
          }
        >
          <p>Isso irá apagar sua transcrição atual, deseja continuar?</p>
        </AppDialog>
      )}

      {showDeleteCutConfirmDialog && (
        <AppDialog
          title="Confirmar exclusão"
          onClose={onCloseDeleteCutConfirm}
          showHeaderClose={false}
          footer={
            <div className="ds-dialog-actions">
              <AppButton variant="primary" onClick={onCloseDeleteCutConfirm}>
                Cancelar
              </AppButton>
              <AppButton variant="secondary" onClick={onConfirmDeleteCut}>
                Apagar
              </AppButton>
            </div>
          }
        >
          <p>Deseja realmente apagar o corte?</p>
          <AppCheckboxField
            label="Não exibir essa mensagem novamente"
            checked={dontAskDeleteCutAgain}
            onChange={onDontAskDeleteCutAgainChange}
            compact
            marginTop="12px"
          />
        </AppDialog>
      )}

      {showHowToUseDialog && (
        <AppDialog
          title="Como utilizar"
          onClose={onCloseHowToUse}
          footer={
            <div className="ds-dialog-actions">
              <AppButton variant="secondary" onClick={onCloseHowToUse}>
                Fechar
              </AppButton>
            </div>
          }
          wide
          scrollable
        >
          <div style={{ display: "grid", gap: "10px", lineHeight: 1.7 }}>
            <p style={{ margin: 0 }}>
              Este aplicativo transforma vídeos longos em cortes verticais de forma guiada. Para
              começar rápido e gerar seus primeiros cortes, siga este fluxo:
            </p>
            <p style={{ margin: 0 }}>
              1. Abra "Gerenciar dependências" e confirme que Python, Whisper, FFmpeg e Ollama estão
              instalados. Se faltar algo, use a instalação automática.
            </p>
            <p style={{ margin: 0 }}>
              2. Faça login no Ollama se for usar modelo cloud. Sem login, a análise por IA pode
              falhar por autenticação.
            </p>
            <p style={{ margin: 0 }}>
              3. Em "Configurar LLM", escolha um modelo funcional. Se usar cloud, mantenha login e
              chave válidos; se usar local, garanta que o modelo está baixado.
            </p>
            <p style={{ margin: 0 }}>
              4. Em "Configurar Whisper", ajuste apenas o essencial (modelo/dispositivo/formato).
              Não precisa configurar tudo para começar.
            </p>
            <p style={{ margin: 0 }}>
              5. Envie um vídeo por URL ou arquivo na seção de upload e selecione esse vídeo na
              lista.
            </p>
            <p style={{ margin: 0 }}>
              6. Clique para transcrever o vídeo. Aguarde finalizar e confira se a transcrição foi
              criada.
            </p>
            <p style={{ margin: 0 }}>
              7. Gere os blocos semânticos e rode a análise. Essa etapa é a que cria as sugestões de
              cortes.
            </p>
            <p style={{ margin: 0 }}>
              8. Revise os cortes sugeridos, ajuste início/fim se necessário e aprove os melhores.
            </p>
            <p style={{ margin: 0 }}>
              9. Renderize os cortes aprovados para gerar os arquivos finais e abra a pasta de saída
              para validar o resultado.
            </p>
            <p style={{ margin: 0 }}>
              Dica: depois que validar o fluxo com um vídeo, use o batch pipeline para processar
              vários vídeos de uma vez.
            </p>
          </div>
        </AppDialog>
      )}
    </>
  );
}
