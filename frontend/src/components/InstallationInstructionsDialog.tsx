import { useEffect, useState } from "react";
import { getInstallationGuide, type InstallationGuide } from "../api";

interface InstallationInstructionsDialogProps {
  dependencyName: string;
  onClose: () => void;
}

export function InstallationInstructionsDialog({
  dependencyName,
  onClose,
}: InstallationInstructionsDialogProps) {
  const [guide, setGuide] = useState<InstallationGuide | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await getInstallationGuide(dependencyName);
        setGuide(data);
      } catch (error) {
        console.error("Failed to load installation guide:", error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [dependencyName]);

  if (isLoading) {
    return (
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "600px" }}
      >
        <p style={{ textAlign: "center", color: "var(--muted)" }}>Carregando instruções...</p>
      </div>
    );
  }

  if (!guide) {
    return (
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "600px" }}
      >
        <p style={{ textAlign: "center", color: "var(--muted)" }}>Erro ao carregar instruções</p>
      </div>
    );
  }

  return (
    <div
      className="dialog"
      onClick={(e) => e.stopPropagation()}
      style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "600px" }}
    >
      <div className="dialog-header">
        <h3>{guide.manual.title}</h3>
        <div className="dialog-actions">
          <button className="icon-btn close-btn" onClick={onClose}>
            X
          </button>
        </div>
      </div>
      <div className="dialog-content" style={{ padding: "20px" }}>
        <p style={{ marginBottom: "16px", color: "var(--muted)" }}>{guide.manual.description}</p>

        <div style={{ marginBottom: "20px" }}>
          <h4 style={{ marginBottom: "12px", fontSize: "14px", fontWeight: "600" }}>Passos:</h4>
          <ol
            style={{ marginLeft: "20px", lineHeight: "1.8", fontSize: "14px", color: "var(--ink)" }}
          >
            {guide.manual.steps.map((step, idx) => (
              <li key={idx} style={{ marginBottom: "8px" }}>
                {step}
              </li>
            ))}
          </ol>
        </div>

        {guide.manual.links && guide.manual.links.length > 0 && (
          <div
            style={{
              marginBottom: "20px",
              padding: "12px",
              background: "var(--bg-contrast)",
              borderRadius: "8px",
            }}
          >
            <h4 style={{ marginBottom: "8px", fontSize: "14px", fontWeight: "600" }}>
              Links úteis:
            </h4>
            <ul style={{ marginLeft: "20px", lineHeight: "1.8", fontSize: "14px" }}>
              {guide.manual.links.map((link, idx) => (
                <li key={idx}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--accent-2)" }}
                  >
                    {link.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {guide.automatic && (
          <div
            style={{
              marginBottom: "20px",
              padding: "12px",
              background: "var(--bg-3)",
              borderRadius: "8px",
              borderLeft: "4px solid var(--success)",
            }}
          >
            <h4 style={{ marginBottom: "8px", fontSize: "14px", fontWeight: "600" }}>
              Instalação Automática:
            </h4>
            <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>
              {guide.automatic.description}
            </p>
            <code
              style={{
                display: "block",
                padding: "8px",
                background: "var(--bg-contrast)",
                borderRadius: "4px",
                fontSize: "11px",
                wordBreak: "break-all",
                fontFamily: "monospace",
              }}
            >
              {guide.automatic.command}
            </code>
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "20px" }}>
          <button
            onClick={onClose}
            className="secondary"
            style={{
              padding: "10px 20px",
              borderRadius: "8px",
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

