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

const normalizeWaNumber = (value) =>
  String(value || "")
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d]/g, "");

export default function GenerateTicket() {
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({
    event_id: "",
    customer_name: "",
    customer_whatsapp: ""
  });
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [locationNote, setLocationNote] = useState("");

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

  const captureLocation = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation not supported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            seller_latitude: position.coords.latitude,
            seller_longitude: position.coords.longitude,
            seller_location_accuracy_m: position.coords.accuracy,
            seller_location_captured_at: new Date().toISOString()
          });
        },
        (error) => reject(error),
        {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0
        }
      );
    });

  const handleGenerate = async (e) => {
    e.preventDefault();
    setMessage("");
    setResult(null);
    setLocationNote("");
    try {
      let locationPayload = {};
      try {
        locationPayload = await captureLocation();
        setLocationNote("Seller location captured.");
      } catch (locErr) {
        setLocationNote("Location unavailable. Ticket created without seller address.");
      }

      const res = await api.post("/tickets", {
        event_id: Number(form.event_id),
        customer_name: form.customer_name,
        customer_whatsapp: form.customer_whatsapp,
        ...locationPayload
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

  const handleShareViaWhatsApp = () => {
    if (!result) return;
    const waNumber = normalizeWaNumber(result.customer_whatsapp);
    if (!waNumber) {
      setMessage("Invalid customer WhatsApp number for sharing.");
      return;
    }

    const event = result.event || {};
    const lines = [
      "PartyPass Ticket",
      `Ticket: ${result.ticket_code}`,
      `Customer: ${result.customer_name || "-"}`,
      `Event: ${event.name || "-"}`,
      `Date/Time: ${event.date || "-"} ${event.time || "-"}`.trim(),
      `Venue: ${event.venue || "-"}`,
      `View Ticket: ${customerLink}`
    ];
    const text = encodeURIComponent(lines.join("\n"));
    const shareUrl = `https://wa.me/${waNumber}?text=${text}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="app">
      <Sidebar role="seller" />
      <main className="main">
        <Header
          title="Generate Ticket"
          subtitle="Create a unique QR ticket and deliver instantly."
        />

        {message && <p className="message error">{message}</p>}
        {locationNote && <p className="message success">{locationNote}</p>}

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
                  {result.seller_location_address && (
                    <p className="muted">Generated at: {result.seller_location_address}</p>
                  )}
                  <a className="link" href={customerLink} target="_blank" rel="noreferrer">
                    Open customer view
                  </a>
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="button secondary tiny"
                      type="button"
                      onClick={handleShareViaWhatsApp}
                    >
                      Share via WhatsApp
                    </button>
                  </div>
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
