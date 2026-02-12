import React, { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import { api } from "../utils/api";

export default function ScanTicket() {
  const [ticketCode, setTicketCode] = useState("");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState(null);
  const [scannerOn, setScannerOn] = useState(true);
  const scannerRef = useRef(null);
  const scanLockRef = useRef(false);
  const toastTimerRef = useRef(null);

  const triggerScanFeedback = (type = "success") => {
    if (navigator.vibrate) {
      navigator.vibrate(type === "success" ? [120] : [80, 50, 80]);
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = type === "success" ? 880 : 220;
      gain.gain.value = 0.06;

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.12);
      oscillator.onended = () => {
        ctx.close().catch(() => null);
      };
    } catch {
      // Ignore audio feedback errors on restricted devices/browsers.
    }
  };

  const showToast = (text, type = "success") => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ text, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 2400);
  };

  const verifyTicket = async (code) => {
    if (!code) return;
    setMessage("");
    setResult(null);
    try {
      const res = await api.post("/scan", {
        ticketCode: code
      });
      setResult(res.data.ticket);
      setTicketCode("");
      triggerScanFeedback("success");
      showToast("Ticket scanned successfully", "success");
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message;
      setMessage(errorMessage);
      triggerScanFeedback("error");
      showToast(errorMessage, "error");
    }
  };

  useEffect(() => {
    if (!scannerOn) {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => null);
        scannerRef.current = null;
      }
      return;
    }

    if (scannerRef.current) return;

    const scanner = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: { width: 220, height: 220 } },
      false
    );

    scanner.render(
      (decodedText) => {
        if (scanLockRef.current) return;
        scanLockRef.current = true;
        verifyTicket(decodedText).finally(() => {
          setTimeout(() => {
            scanLockRef.current = false;
          }, 2000);
        });
      },
      () => null
    );

    scannerRef.current = scanner;

    return () => {
      scanner.clear().catch(() => null);
      scannerRef.current = null;
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, [scannerOn]);

  const handleSubmit = (e) => {
    e.preventDefault();
    verifyTicket(ticketCode);
  };

  return (
    <div className="app">
      <Sidebar role="admin" />
      <main className="main">
        {toast && (
          <div className={`scan-toast ${toast.type}`}>
            {toast.text}
          </div>
        )}
        <Header
          title="Scan Ticket"
          subtitle="Mark entries as used and block duplicates in real time."
          actions={
            <button
              className="button secondary tiny"
              onClick={() => setScannerOn((prev) => !prev)}
            >
              {scannerOn ? "Stop Scanner" : "Start Scanner"}
            </button>
          }
        />

        <section className="panel">
          {scannerOn && <div id="qr-reader" className="qr-reader" />}
          {!scannerOn && (
            <p className="muted">Scanner paused. Use manual entry below.</p>
          )}
        </section>

        <section className="panel">
          <form className="form" onSubmit={handleSubmit}>
            <input
              className="input"
              placeholder="Enter ticket code"
              value={ticketCode}
              onChange={(e) => setTicketCode(e.target.value)}
              required
            />
            <button className="button primary" type="submit">
              Verify Ticket
            </button>
            {message && <p className="message error">{message}</p>}
          </form>
        </section>

        {result && (
          <section className="panel">
            <h2>Verified Ticket</h2>
            <div className="ticket-details">
              <div>
                <p className="muted">Ticket</p>
                <p>{result.ticket_code}</p>
              </div>
              <div>
                <p className="muted">Customer</p>
                <p>{result.customer_name}</p>
              </div>
              <div>
                <p className="muted">Event</p>
                <p>{result.event_name}</p>
              </div>
              <div>
                <p className="muted">Status</p>
                <span className="pill off">Used</span>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
