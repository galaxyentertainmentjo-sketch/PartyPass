import React, { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import { api } from "../utils/api";
import { getUser } from "../utils/auth";

export default function SellerDashboard() {
  const user = getUser();
  const [summary, setSummary] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [message, setMessage] = useState("");

  const loadAll = async () => {
    try {
      const [summaryRes, ticketsRes] = await Promise.all([
        api.get(`/sellers/${user?.id}/summary`),
        api.get(`/sellers/${user?.id}/tickets`)
      ]);
      setSummary(summaryRes.data);
      setTickets(ticketsRes.data);
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => {
    if (user?.id) {
      loadAll();
    }
  }, [user?.id]);

  const statItems = [
    {
      label: "Tickets Sold",
      value: summary?.sold ?? 0,
      tone: "accent"
    },
    {
      label: "Tickets Used",
      value: summary?.used ?? 0,
      tone: "success"
    },
    {
      label: "Remaining",
      value: summary?.remaining ?? 0,
      tone: "info"
    },
    {
      label: "Limit",
      value: summary?.limit ?? 0,
      tone: "dark"
    }
  ];

  return (
    <div className="app">
      <Sidebar role="seller" user={user} />
      <main className="main">
        <Header
          title="Seller Operations"
          subtitle="Generate tickets and track your customers in real time."
        />
        {message && <p className="message error">{message}</p>}

        <div className="stat-grid">
          {statItems.map((stat) => (
            <StatCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              tone={stat.tone}
            />
          ))}
        </div>

        <section className="panel">
          <h2>Recent Tickets</h2>
          <DataTable
            columns={[
              { key: "ticket_code", label: "Ticket" },
              { key: "customer_name", label: "Customer" },
              { key: "event_name", label: "Event" },
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
            data={tickets}
          />
        </section>
      </main>
    </div>
  );
}
