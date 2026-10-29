import axios from "axios";
import { getProtectedReturnPath } from "@/lib/auth/redirect";

export const api = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
  timeout: 15_000,
});

let redirectingToLogin = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error?.response?.status === 401 &&
      typeof window !== "undefined" &&
      !redirectingToLogin
    ) {
      const pathname = window.location.pathname;
      const isAuthForm = pathname === "/login" || pathname === "/register";
      const next = getProtectedReturnPath(pathname, window.location.search, window.location.hash);

      // Invalid credentials stay on the login form. Protected-page 401s send
      // the user back through login and preserve their intended destination.
      if (!isAuthForm && next) {
        redirectingToLogin = true;
        window.location.replace("/login?next=" + encodeURIComponent(next));
      }
    }

    return Promise.reject(error);
  },
);
