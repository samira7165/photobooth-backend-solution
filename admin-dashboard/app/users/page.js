'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import useCurrentUser from '@/lib/useCurrentUser';
import { hasRole, formatDate } from '@/lib/utils';

const ROLES = ['VIEWER', 'OPERATOR', 'ADMIN', 'SUPER_ADMIN'];

export default function UsersPage() {
  const currentUser = useCurrentUser();
  const canManage = hasRole(currentUser?.role, 'SUPER_ADMIN');

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggleActive = async (user) => {
    try {
      await api.patch(`/users/${user.id}`, { isActive: !user.isActive });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update user');
    }
  };

  const handleChangePassword = async (user) => {
    const newPassword = prompt(`New password for ${user.email} (min 8 characters):`);
    if (!newPassword) return;
    try {
      await api.patch(`/users/${user.id}/password`, { password: newPassword });
      alert('Password changed successfully');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to change password');
    }
  };

  const handleDelete = async (user) => {
    if (!confirm(`Delete user ${user.email}?`)) return;
    try {
      await api.delete(`/users/${user.id}`);
      load();
    } catch (err) {
      // 409 here means the user has activity history (e.g. has logged in) —
      // the backend rejects the hard delete and suggests deactivating instead.
      alert(err.response?.data?.message || 'Failed to delete user');
    }
  };

  return (
    <DashboardLayout title="Users">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-400">Staff accounts with access to this dashboard</p>
        {canManage && (
          <button
            onClick={() => setCreateOpen(true)}
            className="text-sm bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg px-3 py-2 transition-colors"
          >
            + Create User
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-white/10">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Created</th>
                {canManage && <th className="px-5 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-gray-500">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-b border-white/5">
                    <td className="px-5 py-3 text-white">{u.name}</td>
                    <td className="px-5 py-3 text-gray-300">{u.email}</td>
                    <td className="px-5 py-3">
                      {canManage ? (
                        <button
                          onClick={() => setEditUser(u)}
                          className="text-xs bg-white/5 hover:bg-white/10 text-gray-200 rounded-lg px-2 py-1"
                        >
                          {u.role}
                        </button>
                      ) : (
                        <span className="text-gray-300">{u.role}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        disabled={!canManage}
                        onClick={() => handleToggleActive(u)}
                        className={`text-xs rounded-full px-2 py-0.5 border ${
                          u.isActive
                            ? 'bg-green-500/20 text-green-300 border-green-500/40'
                            : 'bg-gray-500/20 text-gray-400 border-gray-500/40'
                        } ${canManage ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        {u.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-gray-400">{formatDate(u.createdAt)}</td>
                    {canManage && (
                      <td className="px-5 py-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => handleChangePassword(u)}
                          className="text-xs text-[#2563eb] hover:underline"
                        >
                          Change Password
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          className="text-xs text-red-400 hover:underline"
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          load();
        }}
      />

      <EditRoleModal user={editUser} onClose={() => setEditUser(null)} onSaved={() => { setEditUser(null); load(); }} />
    </DashboardLayout>
  );
}

function CreateUserModal({ open, onClose, onSaved }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('OPERATOR');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/users', { email, password, name, role });
      setEmail('');
      setPassword('');
      setName('');
      setRole('OPERATOR');
      onSaved();
    } catch (err) {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create User">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-red-400 text-sm">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
        >
          {saving ? 'Creating…' : 'Create User'}
        </button>
      </form>
    </Modal>
  );
}

function EditRoleModal({ user, onClose, onSaved }) {
  const [role, setRole] = useState(user?.role || 'OPERATOR');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) setRole(user.role);
  }, [user]);

  if (!user) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch(`/users/${user.id}`, { role });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update role');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!user} onClose={onClose} title={`Change Role — ${user.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-red-400 text-sm">{error}</div>}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Modal>
  );
}
