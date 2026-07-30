'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const COLLECT_FIELD_OPTIONS = ['name', 'phone', 'email'];

export default function CreateCampaignPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const [form, setForm] = useState({
    name: '',
    slug: '',
    processingMode: 'non-ai',
    orientation: 'portrait',
    outputWidth: 1080,
    outputHeight: 1920,
    primaryColor: '#2563eb',
    secondaryColor: '#1e40af',
    backgroundColor: '#ffffff',
    collectFields: ['name', 'phone'],
    outputMode: 'qr',
  });

  const handleNameChange = (value) => {
    setForm((f) => ({
      ...f,
      name: value,
      slug: slugTouched ? f.slug : slugify(value),
    }));
  };

  const toggleCollectField = (field) => {
    setForm((f) => ({
      ...f,
      collectFields: f.collectFields.includes(field)
        ? f.collectFields.filter((x) => x !== field)
        : [...f.collectFields, field],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const res = await api.post('/campaigns', {
        name: form.name,
        slug: form.slug,
        processingMode: form.processingMode,
        photoSettings: {
          orientation: form.orientation,
          outputWidth: Number(form.outputWidth),
          outputHeight: Number(form.outputHeight),
        },
        brandConfig: {
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          backgroundColor: form.backgroundColor,
        },
        collectFields: form.collectFields,
        outputMode: form.outputMode,
      });
      router.push(`/campaigns/${res.data.id}`);
    } catch (err) {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Failed to create campaign');
      setSaving(false);
    }
  };

  return (
    <DashboardLayout title="Create Campaign">
      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <Section title="Basics">
          <Field label="Campaign Name">
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className={inputClass}
              placeholder="Shah Cement Photobooth"
            />
          </Field>
          <Field label="Slug" hint="Lowercase letters, numbers, and hyphens only">
            <input
              type="text"
              required
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setForm((f) => ({ ...f, slug: slugify(e.target.value) }));
              }}
              className={`${inputClass} font-mono`}
              placeholder="shah-cement-2026"
            />
          </Field>
          <Field label="Processing Mode">
            <select
              value={form.processingMode}
              onChange={(e) => setForm((f) => ({ ...f, processingMode: e.target.value }))}
              className={inputClass}
            >
              <option value="non-ai">non-ai</option>
              <option value="ai">ai</option>
              <option value="both">both</option>
            </select>
          </Field>
        </Section>

        <Section title="Photo Settings">
          <Field label="Orientation">
            <select
              value={form.orientation}
              onChange={(e) => setForm((f) => ({ ...f, orientation: e.target.value }))}
              className={inputClass}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Output Width">
              <input
                type="number"
                required
                min={1}
                value={form.outputWidth}
                onChange={(e) => setForm((f) => ({ ...f, outputWidth: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Output Height">
              <input
                type="number"
                required
                min={1}
                value={form.outputHeight}
                onChange={(e) => setForm((f) => ({ ...f, outputHeight: e.target.value }))}
                className={inputClass}
              />
            </Field>
          </div>
        </Section>

        <Section title="Brand Config">
          <div className="grid grid-cols-3 gap-4">
            <ColorField
              label="Primary"
              value={form.primaryColor}
              onChange={(v) => setForm((f) => ({ ...f, primaryColor: v }))}
            />
            <ColorField
              label="Secondary"
              value={form.secondaryColor}
              onChange={(v) => setForm((f) => ({ ...f, secondaryColor: v }))}
            />
            <ColorField
              label="Background"
              value={form.backgroundColor}
              onChange={(v) => setForm((f) => ({ ...f, backgroundColor: v }))}
            />
          </div>
        </Section>

        <Section title="Submission">
          <Field label="Collect Fields">
            <div className="flex gap-4">
              {COLLECT_FIELD_OPTIONS.map((field) => (
                <label key={field} className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={form.collectFields.includes(field)}
                    onChange={() => toggleCollectField(field)}
                    className="rounded border-white/20 bg-[#0a0a0a] text-[#2563eb] focus:ring-[#2563eb]"
                  />
                  {field}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Output Mode">
            <select
              value={form.outputMode}
              onChange={(e) => setForm((f) => ({ ...f, outputMode: e.target.value }))}
              className={inputClass}
            >
              <option value="qr">QR Code</option>
              <option value="download">Download</option>
              <option value="print">Print</option>
            </select>
          </Field>
        </Section>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-5 py-2.5 transition-colors"
          >
            {saving ? 'Creating…' : 'Create Campaign'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/campaigns')}
            className="border border-white/10 hover:bg-white/5 text-gray-300 text-sm font-medium rounded-lg px-5 py-2.5 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </DashboardLayout>
  );
}

const inputClass =
  'w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent';

function Section({ title, children }) {
  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
      <div className="flex items-center gap-2 bg-[#0a0a0a] border border-white/10 rounded-lg px-2 py-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 cursor-pointer"
        />
        <span className="text-xs text-gray-400 font-mono">{value}</span>
      </div>
    </div>
  );
}
