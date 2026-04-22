import * as fs from "fs";
import { homedir } from "os";
import * as path from "path";

export function getCommonFolders(): { folders: { name: string; path: string; exists: boolean }[] } {
  const home = homedir();
  const folders: { name: string; path: string; exists: boolean }[] = [
    {
      name: "📥 Downloads",
      path: path.join(home, "Downloads"),
      exists: false,
    },
    {
      name: "📄 Documentos",
      path: path.join(home, "Documents"),
      exists: false,
    },
    {
      name: "🏠 Home",
      path: home,
      exists: false,
    },
    {
      name: "🖥️ Desktop",
      path: path.join(home, "Desktop"),
      exists: false,
    },
  ];

  folders.forEach((folder) => {
    folder.exists = fs.existsSync(folder.path);
  });

  return { folders };
}
