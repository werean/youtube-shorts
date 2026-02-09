import type React from "react";

interface ActionCardProps {
  children: React.ReactNode;
  description?: string;
  colorClass?: string;
}

export function ActionCard({ children, description, colorClass }: ActionCardProps) {
  return (
    <div className="config-card">
      {children}
      {description && <p className="config-card-description">{description}</p>}
    </div>
  );
}
