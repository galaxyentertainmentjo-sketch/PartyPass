import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../utils/api";

export default function CustomerView() {
  const { ticketId } = useParams();
  const [ticket, setTicket] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const loadTicket = async () => {
      try {
        const res = await api.get(`/tickets/${ticketId}`);
        setTicket(res.data);
      } catch (err) {
        setMessage(err.response?.data?.error || err.message);
      }
    };

    loadTicket();
  }, [ticketId]);

  if (message) {
    return (
      <div className="ticket-view">
        <h2>Ticket Not Found</h2>
        <p>{message}</p>
      </div>
    );
  }

  if (!ticket) {
    return <div className="ticket-view">Loading ticket...</div>;
  }

  return (
    <div className="ticket-view">
      <div className="ticket-card">
        <div className="ticket-meta">
          <span className="badge">PartyPass Ticket</span>
          <h2>{ticket.event_name}</h2>
          <p className="muted">
            {ticket.event_date} at {ticket.event_time} • {ticket.event_venue}
          </p>
        </div>
        <div className="ticket-body">
          <img src={ticket.qr_code_data} alt="Ticket QR" />
          <div>
            <p className="muted">Ticket Code</p>
            <h3>{ticket.ticket_code}</h3>
            <p className="muted">Customer</p>
            <p>{ticket.customer_name}</p>
            <p className="muted">Seller</p>
            <p>{ticket.seller_name}</p>
            <span className={`pill ${ticket.status === "used" ? "off" : "ok"}`}>
              {ticket.status}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
