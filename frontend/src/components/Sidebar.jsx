import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, getUser } from "../utils/auth";

export default function Sidebar({ role }) {
  const user = getUser();
  const navigate = useNavigate();
  const location = useLocation();
  const profilePath = role === "admin" ? "/admin/profile" : "/seller/profile";

  const links =
    role === "admin"
      ? [
          { to: "/admin/dashboard", label: "Dashboard" },
          { to: "/admin/dashboard#sellers", label: "Sellers" },
          { to: "/admin/dashboard#events", label: "Events" },
          { to: "/admin/dashboard#scan-history", label: "Scan History" },
          { to: "/admin/scan", label: "Scan Tickets" }
        ]
      : [
          { to: "/seller/dashboard", label: "Dashboard" },
          { to: "/seller/generate-ticket", label: "Generate Ticket" }
        ];

  const handleLogout = () => {
    clearAuth();
    navigate("/");
  };

  return (
    <aside className="sidebar">
      <div className="brand">PartyPass</div>
      <button
        type="button"
        className={`sidebar-user ${location.pathname === profilePath ? "active" : ""}`}
        onClick={() => navigate(profilePath)}
      >
        <div className="avatar">{user?.name?.charAt(0) || "P"}</div>
        <div>
          <div className="user-name">{user?.name || "Guest"}</div>
          <div className="muted">{role.toUpperCase()}</div>
        </div>
      </button>
      <nav className="nav">
        {links.map((link) => {
          const isActive = `${location.pathname}${location.hash}` === link.to;
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`nav-link ${isActive ? "active" : ""}`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <button className="button ghost" onClick={handleLogout}>
        Logout
      </button>
    </aside>
  );
}
