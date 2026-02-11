import React, { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import { api } from "../utils/api";
import { getToken, getUser, setAuth } from "../utils/auth";

export default function Profile() {
  const user = getUser();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    seller_whatsapp: "",
    avatar_url: ""
  });
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");
  const [adminForm, setAdminForm] = useState({
    current_password: "",
    new_email: "",
    new_password: ""
  });

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await api.get("/profile");
        setProfile(res.data);
        setForm({
          name: res.data?.name || "",
          phone: res.data?.phone || "",
          seller_whatsapp: res.data?.seller_whatsapp || "",
          avatar_url: res.data?.avatar_url || ""
        });
      } catch (err) {
        setMessageType("error");
        setMessage(err.response?.data?.error || err.message);
      }
    };
    loadProfile();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      const res = await api.put("/profile", form);
      setProfile(res.data);
      setAuth(res.data, getToken());
      setMessageType("success");
      setMessage("Profile updated successfully.");
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const handleAdminCredentialsSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      const payload = {
        current_password: adminForm.current_password,
        new_email: adminForm.new_email.trim() || undefined,
        new_password: adminForm.new_password || undefined
      };
      const res = await api.put("/admin/credentials", payload);
      setAuth(res.data.user, getToken());
      setProfile((prev) => ({ ...prev, email: res.data.user.email }));
      setAdminForm({
        current_password: "",
        new_email: "",
        new_password: ""
      });
      setMessageType("success");
      setMessage("Admin credentials updated.");
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const mobileValue = user?.role === "seller" ? form.seller_whatsapp : form.phone;

  return (
    <div className="app">
      <Sidebar role={user?.role || "seller"} user={user} />
      <main className="main">
        <Header
          title="Profile"
          subtitle="Review your registration details and update your info."
        />

        {message && <p className={`message ${messageType}`}>{message}</p>}

        <section className="panel">
          <div className="panel-header">
            <h2>Registration Details</h2>
          </div>
          {!profile ? (
            <p className="muted">Loading profile...</p>
          ) : (
            <div className="grid-2">
              <div>
                <p className="muted">Name</p>
                <p>{profile.name}</p>
                <p className="muted">Email</p>
                <p>{profile.email}</p>
                <p className="muted">Role</p>
                <p>{profile.role}</p>
                <p className="muted">Mobile</p>
                <p>{profile.seller_whatsapp || profile.phone || "Not set"}</p>
              </div>
              <div>
                <p className="muted">Profile Image</p>
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Profile"
                    style={{ width: 120, height: 120, borderRadius: 16, border: "1px solid var(--border)" }}
                  />
                ) : (
                  <div className="avatar" style={{ width: 120, height: 120 }}>
                    {profile.name?.charAt(0) || "P"}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Edit Profile</h2>
          <form className="form" onSubmit={handleSubmit}>
            <input
              className="input"
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="input"
              placeholder="Mobile number"
              value={mobileValue}
              onChange={(e) =>
                user?.role === "seller"
                  ? setForm({ ...form, seller_whatsapp: e.target.value })
                  : setForm({ ...form, phone: e.target.value })
              }
            />
            <input
              className="input"
              placeholder="Profile image URL"
              value={form.avatar_url}
              onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
            />
            <button className="button primary" type="submit">
              Save Changes
            </button>
          </form>
        </section>

        {user?.role === "admin" && (
          <section className="panel">
            <h2>Change Admin Email / Password</h2>
            <form className="form" onSubmit={handleAdminCredentialsSubmit}>
              <input
                className="input"
                type="password"
                placeholder="Current password"
                value={adminForm.current_password}
                onChange={(e) =>
                  setAdminForm({ ...adminForm, current_password: e.target.value })
                }
                required
              />
              <input
                className="input"
                type="email"
                placeholder="New admin email (optional)"
                value={adminForm.new_email}
                onChange={(e) =>
                  setAdminForm({ ...adminForm, new_email: e.target.value })
                }
              />
              <input
                className="input"
                type="password"
                placeholder="New password (optional)"
                value={adminForm.new_password}
                onChange={(e) =>
                  setAdminForm({ ...adminForm, new_password: e.target.value })
                }
              />
              <button className="button secondary" type="submit">
                Update Admin Credentials
              </button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
