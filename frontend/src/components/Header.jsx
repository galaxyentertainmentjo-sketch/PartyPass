import React from "react";

export default function Header({ title, subtitle, actions }) {
  return (
    <div className="header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </div>
  );
}
