import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import SellerDashboard from "./pages/SellerDashboard";
import GenerateTicket from "./pages/GenerateTicket";
import ScanTicket from "./pages/ScanTicket";
import CustomerView from "./pages/CustomerView";
import SellerRegister from "./pages/SellerRegister";
import Profile from "./pages/Profile";
import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/seller/register" element={<SellerRegister />} />
        <Route path="/ticket/view/:ticketId" element={<CustomerView />} />

        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/scan"
          element={
            <ProtectedRoute roles={["admin"]}>
              <ScanTicket />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/profile"
          element={
            <ProtectedRoute roles={["admin"]}>
              <Profile />
            </ProtectedRoute>
          }
        />

        <Route
          path="/seller/dashboard"
          element={
            <ProtectedRoute roles={["seller"]}>
              <SellerDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/seller/generate-ticket"
          element={
            <ProtectedRoute roles={["seller"]}>
              <GenerateTicket />
            </ProtectedRoute>
          }
        />
        <Route
          path="/seller/profile"
          element={
            <ProtectedRoute roles={["seller"]}>
              <Profile />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<h1>Page Not Found</h1>} />
      </Routes>
    </Router>
  );
}
