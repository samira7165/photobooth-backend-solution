'use client';

import { useEffect, useState } from 'react';
import api from './api';

// DashboardLayout already fetches the profile for the header — this is a
// second, independent fetch for pages that need the role to decide whether
// to show write actions (e.g. "Delete Campaign" is SUPER_ADMIN-only). The
// backend re-enforces every permission regardless, so this is UX only, not
// a security boundary.
export default function useCurrentUser() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    api
      .get('/auth/profile')
      .then((res) => setUser(res.data))
      .catch(() => {});
  }, []);

  return user;
}
