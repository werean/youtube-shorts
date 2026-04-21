import { execSync } from "child_process";

export function selectFolderWithSystemPicker(): { selected: boolean; path: string | null } {
  console.log(`[config] Abrindo seletor de pasta...`);

  const psScript = `
$shell = New-Object -ComObject Shell.Application;
$folder = $shell.BrowseForFolder(0, 'Selecione a pasta para armazenar os arquivos', 0x200, 0);
if ($folder -ne $null) {
    $folderPath = $folder.Self.Path;
    Write-Output $folderPath
}
      `.trim();

  const encodedScript = Buffer.from(psScript, "utf16le").toString("base64");

  const output = execSync(`powershell -NoProfile -EncodedCommand ${encodedScript}`, {
    encoding: "utf-8",
    timeout: 60000,
    windowsHide: false,
  }).trim();

  console.log(`[config] Pasta selecionada: ${output}`);

  if (!output) {
    return { selected: false, path: null };
  }

  return { selected: true, path: output };
}
