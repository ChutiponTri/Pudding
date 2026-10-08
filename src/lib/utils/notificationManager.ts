'use client';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'admission_request' | 'student_join' | 'grading' | 'system';
  timestamp: string;
  read: boolean;
  link?: string;
}

const STORAGE_KEY = 'pudding_notifications';
const LISTENERS = new Set<(notifications: AppNotification[]) => void>();

function getStoredNotifications(): AppNotification[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveNotifications(items: AppNotification[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 30)));
  } catch (err) {
    console.error('Failed to save notifications', err);
  }
  LISTENERS.forEach((cb) => cb(items));
}

export const notificationManager = {
  getAll(): AppNotification[] {
    return getStoredNotifications();
  },

  getUnreadCount(): number {
    return getStoredNotifications().filter((n) => !n.read).length;
  },

  add(notif: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) {
    const current = getStoredNotifications();
    const newEntry: AppNotification = {
      ...notif,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      read: false,
    };
    const updated = [newEntry, ...current];
    saveNotifications(updated);

    // Try browser push notification if permitted
    this.sendBrowserNotification(newEntry.title, newEntry.message);

    // Dispatch global event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pudding_new_notification', { detail: newEntry }));
    }

    return newEntry;
  },

  markAsRead(id: string) {
    const current = getStoredNotifications();
    const updated = current.map((n) => (n.id === id ? { ...n, read: true } : n));
    saveNotifications(updated);
  },

  markAllAsRead() {
    const current = getStoredNotifications();
    const updated = current.map((n) => ({ ...n, read: true }));
    saveNotifications(updated);
  },

  clearAll() {
    saveNotifications([]);
  },

  subscribe(listener: (notifications: AppNotification[]) => void) {
    LISTENERS.add(listener);
    listener(getStoredNotifications());
    return () => {
      LISTENERS.delete(listener);
    };
  },

  async requestBrowserPermission(): Promise<NotificationPermission> {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        return perm;
      } catch (e) {
        console.warn('Failed to request notification permission', e);
      }
    }
    return 'denied';
  },

  getPermissionStatus(): NotificationPermission {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'denied';
  },

  sendBrowserNotification(title: string, body: string) {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
        });
      } catch (err) {
        console.warn('Browser notification error:', err);
      }
    }
  },
};
