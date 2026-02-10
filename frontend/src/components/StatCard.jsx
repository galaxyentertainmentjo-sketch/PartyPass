import React from "react";

export default function StatCard({ label, value, footnote, tone = "accent", onClick }) {
  return (
    <div
      className={`stat-card ${tone} ${onClick ? "clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <p className="stat-label">{label}</p>
      <h3 className="stat-value">{value}</h3>
      {footnote && <p className="stat-footnote">{footnote}</p>}
    </div>
  );
}
