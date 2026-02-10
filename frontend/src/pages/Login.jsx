import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../utils/api";
import { setAuth } from "../utils/auth";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      const res = await api.post("/login", { email, password });
      setAuth(res.data.user, res.data.token);
      if (res.data.user.role === "admin") {
        navigate("/admin/dashboard");
      } else {
        navigate("/seller/dashboard");
      }
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="badge">PartyPass</div>
        <h1>Secure event access, one scan only.</h1>
        <p className="muted">
          Admins verify tickets. Sellers generate within limits. Customers
          receive QR codes instantly via WhatsApp.
        </p>
        <form className="form" onSubmit={handleLogin}>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@party.com"
            required
          />
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
          />
          <button className="button primary" type="submit">
            Login
          </button>
          {message && <p className="message error">{message}</p>}
        </form>
        <div className="login-footer">
          <div>Admin demo: admin@party.com / admin123</div>
          <div>
            New seller?{" "}
            <Link className="link" to="/seller/register">
              Register for approval
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
