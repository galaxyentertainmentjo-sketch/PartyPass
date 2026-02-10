import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../utils/api";

export default function SellerRegister() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    seller_whatsapp: ""
  });
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => navigate("/"), 2000);
      return () => clearTimeout(timer);
    }
  }, [success, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setSuccess(false);
    try {
      await api.post("/register", form);
      setSuccess(true);
      setMessage("Registration submitted. Redirecting to login...");
      setForm({ name: "", email: "", password: "", seller_whatsapp: "" });
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="badge">Seller Registration</div>
        <h1>Apply to sell tickets.</h1>
        <p className="muted">
          Your account will be reviewed by an admin before you can issue
          tickets.
        </p>
        <form className="form" onSubmit={handleSubmit}>
          <label className="label">Full name</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Your name"
            required
          />
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@email.com"
            required
          />
          <label className="label">WhatsApp number</label>
          <input
            className="input"
            value={form.seller_whatsapp}
            onChange={(e) =>
              setForm({ ...form, seller_whatsapp: e.target.value })
            }
            placeholder="+1 555 000 1234"
            required
          />
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Create a password"
            required
          />
          <button className="button primary" type="submit">
            Submit Application
          </button>
          {message && (
            <p className={`message ${success ? "success" : "error"}`}>
              {message}
            </p>
          )}
        </form>
        <div className="login-footer">
          Already approved? <Link className="link" to="/">Back to login</Link>
        </div>
      </div>
    </div>
  );
}
