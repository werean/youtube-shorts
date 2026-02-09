import type { Cut } from "../types";
import { formatTimestamp } from "../utils/formatters";

interface CurationSectionProps {
  isLoadingCuts: boolean;
  cuts: Cut[];
  isExpanded: boolean;
  onToggle: () => void;
}

export function CurationSection({
  isLoadingCuts,
  cuts,
  isExpanded,
  onToggle,
}: CurationSectionProps) {
  return (
    <section className="panel" style={{ marginBottom: "24px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h2 style={{ margin: 0, flex: 1 }}>4. Curadoria</h2>
        <button
          onClick={onToggle}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#666",
          }}
          title={isExpanded ? "Recolher" : "Expandir"}
        >
          <i
            className="material-icons"
            style={{
              transform: isExpanded ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 0.3s ease",
            }}
          >
            keyboard_arrow_down
          </i>
        </button>
      </div>
      {isExpanded &&
        (isLoadingCuts ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "20px",
                height: "20px",
                border: "3px solid #f0f0f0",
                borderTop: "3px solid #666",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <span>Carregando cortes...</span>
          </div>
        ) : cuts.length === 0 ? (
          <p className="muted">Execute a análise para ver os cortes.</p>
        ) : (
          <div className="cuts">
            {cuts.map((cut) => (
              <article key={cut.cut_id} className="cut-card">
                <header>
                  <div>
                    <h3>{cut.cut_id}</h3>
                    <p>
                      {formatTimestamp(cut.start)} - {formatTimestamp(cut.end)}
                    </p>
                    <p className="muted">Status: {cut.status}</p>
                  </div>
                  {cut.score !== undefined && cut.score !== null && (
                    <div className="score">{cut.score}</div>
                  )}
                </header>
                <div className="reason">
                  <strong>🎣 Hook:</strong> {cut.hook_reason || "-"}
                </div>
                <div className="reason">
                  <strong>📢 Conteúdo:</strong> {cut.content_reason || "-"}
                </div>
              </article>
            ))}
          </div>
        ))}
    </section>
  );
}
