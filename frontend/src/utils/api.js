import axios from "axios";
import { clearAuth, getToken } from "./auth";

const rawBaseUrl = import.meta.env.VITE_API_URL || "";
const trimmedBaseUrl = rawBaseUrl.trim();
const baseURL = trimmedBaseUrl
  ? /^https?:\/\//i.test(trimmedBaseUrl)
    ? trimmedBaseUrl
    : `https://${trimmedBaseUrl}`
  : "http://localhost:5000/api";

export const api = axios.create({
  baseURL
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearAuth();
      if (window.location.pathname !== "/") {
        window.location.href = "/";
      }
    }
    return Promise.reject(error);
  }
);
