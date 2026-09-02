import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { listMyNotifications, countUnread, markRead as svcMarkRead, markAllRead as svcMarkAllRead } from '@/services/notificationService';

const NotificationContext = createContext({});

// Plain polling, not a realtime subscription — this app deliberately runs
// with realtime throttled to 0 events/sec (src/lib/supabase.js:44) and
// nothing else in the codebase uses supabase.channel()/postgres_changes, so
// polling matches the established convention instead of introducing a new one.
const POLL_MS = 45000;

export function NotificationProvider({ children }) {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data }, { count }] = await Promise.all([
      listMyNotifications(profile.id),
      countUnread(profile.id),
    ]);
    setNotifications(data || []);
    setUnreadCount(count || 0);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const markRead = useCallback(async (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id && !n.is_read ? { ...n, is_read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    await svcMarkRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!profile?.id) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    await svcMarkAllRead(profile.id);
  }, [profile?.id]);

  const value = useMemo(() => ({
    notifications, unreadCount, loading, refresh: load, markRead, markAllRead,
  }), [notifications, unreadCount, loading, load, markRead, markAllRead]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
