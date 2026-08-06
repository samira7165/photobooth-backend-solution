import { io } from 'socket.io-client';
import { API_ORIGIN } from './api';

// A single shared connection for the whole session — DashboardLayout (live
// indicator + queue stats), the dashboard overview page, and
// LiveActivityFeed (mounted once in the root layout, so it outlives every
// individual page) all call getSocket() and get back the same instance.
// Because of that, nothing here disconnects on a page's unmount — doing so
// would kill the connection out from under whichever of those is still
// mounted. Only handleLogout() (Sidebar) calls disconnectSocket().
let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(`${API_ORIGIN}/ws`, {
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      socket.emit('admin:join');
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
