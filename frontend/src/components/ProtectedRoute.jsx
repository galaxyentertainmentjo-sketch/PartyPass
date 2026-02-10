import React from "react";
import { Navigate } from "react-router-dom";
import { getToken, getUser } from "../utils/auth";

export default function ProtectedRoute({ roles, children }) {
  const user = getUser();
  const token = getToken();

  if (!user || !token) {
    return <Navigate to="/" replace />;
  }

  if (roles && roles.length && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
