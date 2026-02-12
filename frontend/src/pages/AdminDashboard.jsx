import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import { api } from "../utils/api";
import { getUser } from "../utils/auth";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip
} from "recharts";

const COLORS = ["#ff6b35", "#1f7ae0", "#1c9b5f", "#d64545"];

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return isNaN(date.getTime()) ? value : date.toLocaleString();
};

const toISODate = (date) => date.toISOString().slice(0, 10);

const formatPhone = (value) => {
  if (!value) return "";
  return String(value).replace(/^whatsapp:/i, "").trim();
};

export default function AdminDashboard() {
  const location = useLocation();
  const user = getUser();
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [limitEdits, setLimitEdits] = useState({});
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("error");
  const [eventForm, setEventForm] = useState({
    name: "",
    date: "",
    time: "",
    venue: ""
  });
  const [editEventId, setEditEventId] = useState("");
  const [editEventForm, setEditEventForm] = useState({
    name: "",
    date: "",
    time: "",
    venue: ""
  });
  const [selectedSeller, setSelectedSeller] = useState(null);
  const [sellerTickets, setSellerTickets] = useState([]);
  const [sellerSummary, setSellerSummary] = useState(null);
  const [sellerLoading, setSellerLoading] = useState(false);
  const [ticketsModalOpen, setTicketsModalOpen] = useState(false);
  const [allTickets, setAllTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalRows, setModalRows] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);

  const loadAll = async () => {
    try {
      const [statsRes, eventsRes, sellersRes, logsRes] = await Promise.all([
        api.get("/admin/stats"),
        api.get("/events"),
        api.get("/sellers"),
        api.get("/scan-logs")
      ]);
      setStats(statsRes.data);
      setEvents(eventsRes.data);
      setSellers(sellersRes.data);
      setLogs(logsRes.data);
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await api.post("/events", eventForm);
      setEventForm({ name: "", date: "", time: "", venue: "" });
      loadAll();
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const handleSelectEditEvent = (eventId) => {
    setEditEventId(eventId);
    const selected = events.find((event) => String(event.id) === String(eventId));
    if (!selected) {
      setEditEventForm({ name: "", date: "", time: "", venue: "" });
      return;
    }
    setEditEventForm({
      name: selected.name || "",
      date: selected.date || "",
      time: selected.time || "",
      venue: selected.venue || ""
    });
  };

  const handleUpdateEvent = async (e) => {
    e.preventDefault();
    if (!editEventId) {
      setMessageType("error");
      setMessage("Select an event to edit.");
      return;
    }
    setMessage("");
    try {
      await api.put(`/events/${editEventId}`, editEventForm);
      loadAll();
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const handleDeactivate = async (id) => {
    setMessage("");
    try {
      await api.patch(`/events/${id}/deactivate`);
      loadAll();
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const handleActivate = async (id) => {
    setMessage("");
    try {
      await api.patch(`/events/${id}/activate`);
      loadAll();
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const handleDeleteEvent = async (id) => {
    const confirmed = window.confirm(
      "Delete this event permanently? Existing tickets remain valid."
    );
    if (!confirmed) return;
    setMessage("");
    try {
      await api.delete(`/events/${id}`);
      loadAll();
    } catch (err) {
      setMessageType("error");
      const errorMessage = err.response?.data?.error || err.message;
      setMessage(errorMessage);
      window.alert(errorMessage);
    }
  };

  const handleApprove = async (id) => {
    setMessage("");
    try {
      const res = await api.patch(`/sellers/${id}/approve`);
      if (res.data?.notifications) {
        const note = Object.entries(res.data.notifications)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" | ");
        setMessageType("success");
        setMessage(`Seller approved. Notifications -> ${note}`);
      }
      loadAll();
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const handleLimitSave = async (id) => {
    setMessage("");
    try {
      const ticket_limit = Number(limitEdits[id]);
      await api.patch(`/sellers/${id}/limit`, { ticket_limit });
      setMessageType("success");
      setMessage("Seller ticket limit saved.");
      window.alert("Seller ticket limit saved successfully.");
      loadAll();
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const handleSellerSelect = async (seller) => {
    if (selectedSeller?.id === seller.id) {
      clearSellerSelection();
      return;
    }
    setSelectedSeller(seller);
    setSellerLoading(true);
    setSellerTickets([]);
    setSellerSummary(null);
    try {
      const [ticketsRes, summaryRes] = await Promise.all([
        api.get(`/sellers/${seller.id}/tickets`),
        api.get(`/sellers/${seller.id}/summary`)
      ]);
      setSellerTickets(ticketsRes.data);
      setSellerSummary(summaryRes.data);
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    } finally {
      setSellerLoading(false);
    }
  };

  const clearSellerSelection = () => {
    setSelectedSeller(null);
    setSellerTickets([]);
    setSellerSummary(null);
  };

  const handleSuspend = async (id) => {
    setMessage("");
    try {
      await api.patch(`/sellers/${id}/suspend`);
      loadAll();
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const handleUnsuspend = async (id) => {
    setMessage("");
    try {
      await api.patch(`/sellers/${id}/unsuspend`);
      loadAll();
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const handleDeleteSeller = async (id) => {
    const confirmed = window.confirm(
      "Delete this seller and all their tickets? This cannot be undone."
    );
    if (!confirmed) return;
    setMessage("");
    try {
      await api.delete(`/sellers/${id}`);
      loadAll();
    } catch (err) {
      setMessageType("error");
      const errorMessage = err.response?.data?.error || err.message;
      setMessage(errorMessage);
      window.alert(errorMessage);
    }
  };

  const handleExportLogs = () => {
    if (!logs.length) return;
    const headers = ["ticket_code", "customer_name", "event_name", "seller_name", "scanned_at"];
    const rows = logs.map((log) =>
      headers
        .map((key) => {
          const value = log[key] ?? "";
          return `"${String(value).replace(/"/g, '""')}"`;
        })
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "scan-logs.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const openTicketsModal = async (mode) => {
    setActiveModal(mode);
    setModalLoading(true);
    setModalRows([]);
    if (mode === "tickets") setModalTitle("All Tickets");
    if (mode === "used") setModalTitle("Used Tickets");
    if (mode === "events") setModalTitle("Active Events");
    if (mode === "sellers") setModalTitle("Sellers");
    try {
      if (mode === "events") {
        const res = await api.get("/admin/events");
        setModalRows(res.data.filter((event) => event.active));
      } else if (mode === "sellers") {
        const res = await api.get("/sellers");
        setModalRows(res.data);
      } else {
        const res = await api.get("/tickets");
        const tickets = res.data || [];
        setModalRows(mode === "used" ? tickets.filter((t) => t.status === "used") : tickets);
      }
    } catch (err) {
      setMessageType("error");
      setMessage(err.response?.data?.error || err.message);
    } finally {
      setModalLoading(false);
    }
  };

  const closeTicketsModal = () => {
    setActiveModal(null);
    setModalRows([]);
  };

  const statItems = [
    {
      label: "Total Tickets",
      value: stats?.total_tickets ?? 0,
      tone: "accent"
    },
    {
      label: "Used Tickets",
      value: stats?.used_tickets ?? 0,
      tone: "success"
    },
    {
      label: "Active Events",
      value: stats?.active_events ?? 0,
      tone: "info"
    },
    {
      label: "Sellers",
      value: stats?.sellers ?? 0,
      tone: "dark"
    }
  ];

  const pendingCount = sellers.filter((seller) => !seller.approved).length;
  const filteredSellers = showPendingOnly
    ? sellers.filter((seller) => !seller.approved)
    : sellers;

  const chartData = useMemo(() => {
    const ticketBreakdown = [
      { name: "Used", value: stats?.used_tickets ?? 0 },
      { name: "Unused", value: stats?.unused_tickets ?? 0 }
    ];

    const today = new Date();
    const days = Array.from({ length: 7 }).map((_, idx) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - idx));
      return toISODate(date);
    });

    const scansByDate = days.map((day) => ({
      day: day.slice(5),
      scans: logs.filter((log) => log.scanned_at?.startsWith(day)).length
    }));

    const sellerProgress = sellers.slice(0, 6).map((seller) => ({
      name: seller.name,
      sold: seller.tickets_sold,
      limit: seller.ticket_limit
    }));

    return { ticketBreakdown, scansByDate, sellerProgress };
  }, [stats, logs, sellers]);

  const activeSection = location.hash?.replace("#", "") || "all";
  const isAllView = activeSection === "all";
  const isEventsView = activeSection === "events";
  const isSellersView = activeSection === "sellers";

  const showSection = (id) => activeSection === "all" || activeSection === id;


  return (
    <div className="app">
      <Sidebar role="admin" user={user} />
      <main className="main">
        <Header
          title="Admin Control Center"
          subtitle="Live verification, seller oversight, and event operations."
          actions={
            <div className="header-actions">
              {(isAllView || isSellersView) && (
                <div className="filter-group">
                  <button
                    className={`button ${!showPendingOnly ? "primary" : "secondary"} tiny`}
                    onClick={() => setShowPendingOnly(false)}
                  >
                    All ({sellers.length})
                  </button>
                  {pendingCount > 0 && (
                    <button
                      className={`button ${showPendingOnly ? "primary" : "secondary"} tiny`}
                      onClick={() => setShowPendingOnly(true)}
                    >
                      Pending ({pendingCount})
                    </button>
                  )}
                </div>
              )}
              {isAllView && (
                <button className="button secondary tiny" onClick={handleExportLogs}>
                  Export Logs
                </button>
              )}
            </div>
          }
        />

        {message && <p className={`message ${messageType}`}>{message}</p>}

        {isAllView && (
          <>
            <div className="stat-grid">
              {statItems.map((stat) => {
                const clickMap = {
                  "Total Tickets": () => openTicketsModal("tickets"),
                  "Used Tickets": () => openTicketsModal("used"),
                  "Active Events": () => openTicketsModal("events"),
                  Sellers: () => openTicketsModal("sellers")
                };
                return (
                  <StatCard
                    key={stat.label}
                    label={stat.label}
                    value={stat.value}
                    tone={stat.tone}
                    onClick={clickMap[stat.label]}
                  />
                );
              })}
            </div>

            <div className="chart-grid">
              <section className="panel chart-card">
                <h2>Ticket Status</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={chartData.ticketBreakdown}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={90}
                    >
                      {chartData.ticketBreakdown.map((entry, index) => (
                        <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </section>

              <section className="panel chart-card">
                <h2>Scans (Last 7 Days)</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData.scansByDate}>
                    <XAxis dataKey="day" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="scans" fill="#1f7ae0" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>

              <section className="panel chart-card">
                <h2>Top Sellers</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData.sellerProgress} layout="vertical">
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis dataKey="name" type="category" width={120} />
                    <Tooltip />
                    <Bar dataKey="sold" fill="#ff6b35" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>
            </div>

          </>
        )}

        {isEventsView && (
          <div className="grid-2">
            <section className="panel">
              <h2>New Event</h2>
              <form className="form" onSubmit={handleCreateEvent}>
                <input
                  className="input"
                  placeholder="Event name"
                  value={eventForm.name}
                  onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
                />
                <div className="form-row">
                  <input
                    className="input"
                    type="date"
                    value={eventForm.date}
                    onChange={(e) =>
                      setEventForm({ ...eventForm, date: e.target.value })
                    }
                  />
                  <input
                    className="input"
                    type="time"
                    value={eventForm.time}
                    onChange={(e) =>
                      setEventForm({ ...eventForm, time: e.target.value })
                    }
                  />
                </div>
                <input
                  className="input"
                  placeholder="Venue"
                  value={eventForm.venue}
                  onChange={(e) =>
                    setEventForm({ ...eventForm, venue: e.target.value })
                  }
                />
                <button className="button primary" type="submit">
                  Create Event
                </button>
              </form>
            </section>

            <section className="panel">
              <h2>Edit Event</h2>
              <form className="form" onSubmit={handleUpdateEvent}>
                <select
                  className="input"
                  value={editEventId}
                  onChange={(e) => handleSelectEditEvent(e.target.value)}
                >
                  <option value="">Select event</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name} ({event.date} {event.time})
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  placeholder="Event name"
                  value={editEventForm.name}
                  onChange={(e) =>
                    setEditEventForm({ ...editEventForm, name: e.target.value })
                  }
                  disabled={!editEventId}
                />
                <div className="form-row">
                  <input
                    className="input"
                    type="date"
                    value={editEventForm.date}
                    onChange={(e) =>
                      setEditEventForm({ ...editEventForm, date: e.target.value })
                    }
                    disabled={!editEventId}
                  />
                  <input
                    className="input"
                    type="time"
                    value={editEventForm.time}
                    onChange={(e) =>
                      setEditEventForm({ ...editEventForm, time: e.target.value })
                    }
                    disabled={!editEventId}
                  />
                </div>
                <input
                  className="input"
                  placeholder="Venue"
                  value={editEventForm.venue}
                  onChange={(e) =>
                    setEditEventForm({ ...editEventForm, venue: e.target.value })
                  }
                  disabled={!editEventId}
                />
                <button className="button secondary" type="submit" disabled={!editEventId}>
                  Update Event
                </button>
              </form>
            </section>
          </div>
        )}

        {(isAllView || isEventsView) && (
            <section className="panel" id="events">
              <div className="panel-header">
                <h2>Events</h2>
                <span className="muted">Deactivate removes from seller list only.</span>
              </div>
              <DataTable
                columns={[
                  { key: "name", label: "Event" },
                  { key: "date", label: "Date" },
                  { key: "time", label: "Time" },
                  { key: "venue", label: "Venue" },
                  {
                    key: "active",
                    label: "Status",
                    render: (row) => (
                      <span className={`pill ${row.active ? "ok" : "off"}`}>
                        {row.active ? "Active" : "Inactive"}
                      </span>
                    )
                  },
                  {
                    key: "actions",
                    label: "Actions",
                    render: (row) => (
                      <div className="inline-input">
                        {row.active ? (
                          <button
                            className="button secondary tiny"
                            onClick={() => handleDeactivate(row.id)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="button primary tiny"
                            onClick={() => handleActivate(row.id)}
                          >
                            Activate
                          </button>
                        )}
                        <button
                          className="button ghost danger tiny"
                          onClick={() => handleDeleteEvent(row.id)}
                          disabled={row.active}
                          title={
                            row.active
                              ? "Deactivate the event before deleting"
                              : "Delete event"
                          }
                        >
                          Delete
                        </button>
                      </div>
                    )
                  }
                ]}
                data={events}
              />
            </section>
        )}

        {showSection("sellers") && (
        <section className="panel" id="sellers">
          <h2>Sellers</h2>
          <DataTable
            columns={[
              {
                key: "name",
                label: "Seller",
                render: (row) => (
                    <button
                      className={`link-button ${selectedSeller?.id === row.id ? "active" : ""}`}
                      onClick={() => handleSellerSelect(row)}
                    >
                      {row.name}
                    </button>
                )
              },
              { key: "email", label: "Email" },
              {
                key: "performance",
                label: "Performance",
                render: (row) => {
                  const progress = Math.min(
                    (row.tickets_sold / row.ticket_limit) * 100,
                    100
                  );
                  return (
                    <div className="progress">
                      <div
                        className="progress-bar"
                        style={{ width: `${progress || 0}%` }}
                      />
                      <span className="progress-label">
                        {row.tickets_sold}/{row.ticket_limit}
                      </span>
                    </div>
                  );
                }
              },
              {
                key: "approved",
                label: "Approval",
                render: (row) =>
                  row.approved ? (
                    <span className="pill ok">Approved</span>
                  ) : (
                    <button
                      className="button primary"
                      onClick={() => handleApprove(row.id)}
                    >
                      Approve
                    </button>
                  )
              },
              {
                key: "status",
                label: "Status",
                render: (row) =>
                  row.suspended ? (
                    <span className="pill off">Suspended</span>
                  ) : (
                    <span className="pill ok">Active</span>
                  )
              },
              {
                key: "limit",
                label: "Limit",
                render: (row) => (
                  <div className="inline-input">
                    <input
                      className="input compact"
                      type="number"
                      value={
                        limitEdits[row.id] !== undefined
                          ? limitEdits[row.id]
                          : row.ticket_limit
                      }
                      onChange={(e) =>
                        setLimitEdits({
                          ...limitEdits,
                          [row.id]: e.target.value
                        })
                      }
                    />
                    <button
                      className="button secondary"
                      onClick={() => handleLimitSave(row.id)}
                    >
                      Save
                    </button>
                  </div>
                )
              },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="inline-input">
                    {row.suspended ? (
                      <button
                        className="button primary tiny"
                        onClick={() => handleUnsuspend(row.id)}
                      >
                        Reactivate
                      </button>
                    ) : (
                      <button
                        className="button secondary tiny"
                        onClick={() => handleSuspend(row.id)}
                      >
                        Suspend
                      </button>
                    )}
                    <button
                      className="button ghost danger tiny"
                      onClick={() => handleDeleteSeller(row.id)}
                      disabled={!row.suspended}
                      title={
                        row.suspended
                          ? "Delete seller"
                          : "Suspend the seller before deleting"
                      }
                    >
                      Delete
                    </button>
                  </div>
                )
              }
            ]}
            data={filteredSellers}
          />
        </section>
        )}

        {selectedSeller && showSection("sellers") && (
          <section className="panel">
            <div className="panel-header">
              <h2>{selectedSeller.name} — Ticket Details</h2>
              <button className="button ghost danger tiny" onClick={clearSellerSelection}>
                Close
              </button>
            </div>
            {sellerLoading && <p className="muted">Loading seller details...</p>}
            {!sellerLoading && sellerSummary && (
              <div className="stat-grid">
                <StatCard label="Tickets Sold" value={sellerSummary.sold} tone="accent" />
                <StatCard label="Tickets Used" value={sellerSummary.used} tone="success" />
                <StatCard label="Remaining" value={sellerSummary.remaining} tone="info" />
                <StatCard label="Limit" value={sellerSummary.limit} tone="dark" />
              </div>
            )}
            {!sellerLoading && (
              <DataTable
                columns={[
                  { key: "ticket_code", label: "Ticket" },
                  { key: "customer_name", label: "Customer" },
                  { key: "event_name", label: "Event" },
                  {
                    key: "seller_location_address",
                    label: "Generated Address",
                    render: (row) => row.seller_location_address || "Not captured"
                  },
                  {
                    key: "status",
                    label: "Status",
                    render: (row) => (
                      <span className={`pill ${row.status === "used" ? "off" : "ok"}`}>
                        {row.status}
                      </span>
                    )
                  },
                  { key: "issued_at", label: "Issued" }
                ]}
                data={sellerTickets}
              />
            )}
          </section>
        )}

        {showSection("scan-history") && (
        <section className="panel" id="scan-history">
          <h2>Scan History ({logs.length})</h2>
          <DataTable
            columns={[
              { key: "ticket_code", label: "Ticket No." },
              { key: "event_name", label: "Event" },
              { key: "customer_name", label: "Customer" },
              {
                key: "mobile",
                label: "Mobile",
                render: (row) => formatPhone(row.customer_whatsapp)
              },
              { key: "seller_name", label: "Seller" },
              {
                key: "issued_at",
                label: "Issued At",
                render: (row) => formatDate(row.issued_at)
              },
              {
                key: "scanned_at",
                label: "Scanned At",
                render: (row) => formatDate(row.scanned_at)
              }
            ]}
            data={logs}
          />
        </section>
        )}

        {activeModal && (
          <div className="modal-overlay" onClick={closeTicketsModal}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{modalTitle}</h2>
                <button className="button ghost danger tiny" onClick={closeTicketsModal}>
                  Close
                </button>
              </div>
              {modalLoading ? (
                <p className="muted">Loading details...</p>
              ) : (
                <>
                  {activeModal === "events" && (
                    <DataTable
                      columns={[
                        { key: "name", label: "Event" },
                        { key: "date", label: "Date" },
                        { key: "time", label: "Time" },
                        { key: "venue", label: "Venue" },
                        {
                          key: "active",
                          label: "Status",
                          render: (row) => (
                            <span className={`pill ${row.active ? "ok" : "off"}`}>
                              {row.active ? "Active" : "Inactive"}
                            </span>
                          )
                        }
                      ]}
                      data={modalRows}
                    />
                  )}
                  {activeModal === "sellers" && (
                    <DataTable
                      columns={[
                        { key: "name", label: "Seller" },
                        { key: "email", label: "Email" },
                        {
                          key: "approved",
                          label: "Approved",
                          render: (row) => (
                            <span className={`pill ${row.approved ? "ok" : "off"}`}>
                              {row.approved ? "Yes" : "No"}
                            </span>
                          )
                        },
                        {
                          key: "suspended",
                          label: "Suspended",
                          render: (row) => (
                            <span className={`pill ${row.suspended ? "off" : "ok"}`}>
                              {row.suspended ? "Yes" : "No"}
                            </span>
                          )
                        },
                        { key: "tickets_sold", label: "Tickets Sold" },
                        { key: "ticket_limit", label: "Limit" }
                      ]}
                      data={modalRows}
                    />
                  )}
                  {(activeModal === "tickets" || activeModal === "used") && (
                    <DataTable
                      columns={[
                        { key: "ticket_code", label: "Ticket" },
                        { key: "customer_name", label: "Customer" },
                        { key: "event_name", label: "Event" },
                        { key: "seller_name", label: "Seller" },
                        {
                          key: "seller_location_address",
                          label: "Generated Address",
                          render: (row) => row.seller_location_address || "Not captured"
                        },
                        {
                          key: "status",
                          label: "Status",
                          render: (row) => (
                            <span className={`pill ${row.status === "used" ? "off" : "ok"}`}>
                              {row.status}
                            </span>
                          )
                        },
                        { key: "issued_at", label: "Issued" }
                      ]}
                      data={modalRows}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
