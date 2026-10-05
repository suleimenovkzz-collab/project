import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ADMIN_UNAUTHORIZED_EVENT, adminApi } from "../api/admin";
import { ADMIN_TOKEN_KEY } from "../lib/constants";
import { storageRemove } from "../lib/storage";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState("");

  const checkAuth = useCallback(async () => {
    try {
      const me = await adminApi("/api/me");
      setAuthenticated(Boolean(me.authenticated));
      setNotice("");
    } catch (error) {
      setAuthenticated(false);
      setNotice(
        error.status === 0
          ? "Сервер недоступен. Проверьте подключение и обновите страницу."
          : error.message
      );
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // Session lives only in the httpOnly cookie; drop tokens saved by older builds.
    storageRemove(ADMIN_TOKEN_KEY);
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const onUnauthorized = () => {
      setAuthenticated(false);
      setNotice("Сессия истекла. Войдите снова — несохранённые изменения нужно будет повторить.");
    };
    window.addEventListener(ADMIN_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(ADMIN_UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (password) => {
    const result = await adminApi("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setAuthenticated(true);
    setNotice("");
    return result;
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminApi("/api/logout", { method: "POST" });
    } catch (error) {
      console.warn("[admin] logout request failed:", error);
    }
    setAuthenticated(false);
    setNotice("");
  }, []);

  const value = useMemo(
    () => ({
      authenticated,
      checking,
      notice,
      login,
      logout,
      checkAuth,
    }),
    [authenticated, checking, notice, login, logout, checkAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
