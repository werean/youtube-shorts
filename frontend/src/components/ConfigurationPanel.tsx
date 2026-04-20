import { ConfigurationSection } from "./ConfigurationSection";

interface ConfigurationPanelProps {
  onShowConfigureAppDialog: () => void;
  onShowDependenciesDialog: () => void;
  onShowLLMConfigDialog: () => void;
  onShowWhisperConfigDialog: () => void;
  onShowFFmpegConfigDialog?: () => void;
  onShowHowToUse?: () => void;
}

export function ConfigurationPanel({
  onShowConfigureAppDialog,
  onShowDependenciesDialog,
  onShowLLMConfigDialog,
  onShowWhisperConfigDialog,
  onShowFFmpegConfigDialog,
  onShowHowToUse,
}: ConfigurationPanelProps) {
  return (
    <ConfigurationSection
      onConfigureApp={onShowConfigureAppDialog}
      onManageDependencies={onShowDependenciesDialog}
      onConfigureLLM={onShowLLMConfigDialog}
      onConfigureWhisper={onShowWhisperConfigDialog}
      onConfigureFFmpeg={onShowFFmpegConfigDialog || (() => {})}
      onShowHowToUse={onShowHowToUse}
    />
  );
}
