import React, { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import { api } from "../utils/api";

const formatDelivery = (delivery) => {
  if (!delivery) return "Pending";
  if (typeof delivery === "string") return delivery;
  if (delivery.status === "sent") {
    return delivery.media === "attached" ? "Sent (with QR)" : "Sent";
  }
  if (delivery.status) {
    return `${delivery.status}${delivery.error ? `: ${delivery.error}` : ""}`;
  }
  return "Pending";
};

export default function GenerateTicket() {
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({
    event_id: "",
    customer_name: "",
    customer_whatsapp: ""
  });
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");

  const loadEvents = async () => {
    try {
      const res = await api.get("/events?active=1");
      setEvents(res.data);
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const handleGenerate = async (e) => {
    e.preventDefault();
    setMessage("");
    setResult(null);
    try {
      const res = await api.post("/tickets", {
        event_id: Number(form.event_id),
        customer_name: form.customer_name,
        customer_whatsapp: form.customer_whatsapp
      });
      setResult(res.data);
      setForm({ event_id: "", customer_name: "", customer_whatsapp: "" });
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const customerLink = result
    ? `${window.location.origin}/ticket/view/${result.ticket_code}`
    : "";

  return (
    <div className="app">
      <Sidebar role="seller" />
      <main className="main">
        <Header
          title="Generate Ticket"
          subtitle="Create a unique QR ticket and deliver instantly."
        />

        {message && <p className="message error">{message}</p>}

        <div className="grid-2">
          <section className="panel">
            <h2>Ticket Details</h2>
            <form className="form" onSubmit={handleGenerate}>
              <select
                className="input"
                value={form.event_id}
                onChange={(e) => setForm({ ...form, event_id: e.target.value })}
                required
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
                placeholder="Customer name"
                value={form.customer_name}
                onChange={(e) =>
                  setForm({ ...form, customer_name: e.target.value })
                }
                required
              />
              <input
                className="input"
                placeholder="WhatsApp number"
                value={form.customer_whatsapp}
                onChange={(e) =>
                  setForm({ ...form, customer_whatsapp: e.target.value })
                }
                required
              />
              <button className="button primary" type="submit">
                Generate Ticket
              </button>
            </form>
          </section>

          <section className="panel">
            <h2>Delivery Preview</h2>
            {result ? (
              <div className="qr-card">
                <img src={result.qr} alt="Ticket QR" />
                <div className="qr-details">
                  <p className="qr-title">{result.ticket_code}</p>
                  <p className="muted">
                    WhatsApp delivery: {formatDelivery(result.whatsapp_delivery)}
                  </p>
                  <a className="link" href={customerLink} target="_blank" rel="noreferrer">
                    Open customer view
                  </a>
                </div>
              </div>
            ) : (
              <p className="muted">Generate a ticket to preview the QR code.</p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
