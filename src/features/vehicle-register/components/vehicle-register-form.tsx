'use client';

import { useEffect, useState } from 'react';
import { FileUp, Loader2, Trash2 } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import type { Policy, VehicleRegistration } from '@/shared/types';
import { ChoiceGrid, Field, Notice } from '@/components/ui';

/**
 * The registration form itself — shared by the standalone "Register your
 * Vehicle" page and the Personal Vehicle step inside a claim, so registering
 * from either place behaves identically and stays in sync.
 */
export function VehicleRegisterForm({
  policy,
  initial,
  onSubmitted,
}: {
  policy: Policy;
  initial?: VehicleRegistration | null;
  onSubmitted: (v: VehicleRegistration) => void;
}) {
  const [vehicleType, setVehicleType] = useState<'Bike' | 'Car'>(
    initial?.vehicleType || 'Bike',
  );
  const [model, setModel] = useState(initial?.model || '');
  const [fuelType, setFuelType] = useState(
    initial?.fuelType || policy.fuelTypes[0]?.value || '',
  );
  const [mileage, setMileage] = useState(initial?.mileageKmPerLitre || 0);
  const [imageLink, setImageLink] = useState(initial?.imageLink || '');
  const [imageName, setImageName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [maxBytes, setMaxBytes] = useState(50 * 1024 * 1024);
  const [uploadEnabled, setUploadEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .uploadConfig()
      .then((c) => {
        setUploadEnabled(c.enabled);
        setMaxBytes(c.maxBytes);
      })
      .catch(() => {});
  }, []);

  async function acceptImage(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setError('');
    if (file.size > maxBytes) {
      setError(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      );
      return;
    }
    setUploading(true);
    try {
      const saved = await api.upload(file, 0);
      setImageLink(saved.link);
      setImageName(saved.name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const { vehicle } = await api.registerVehicle({
        vehicleType,
        model: model.trim(),
        fuelType,
        mileageKmPerLitre: mileage,
        imageLink,
      });
      onSubmitted(vehicle);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ChoiceGrid
        value={vehicleType}
        onChange={(v) => setVehicleType(v as 'Bike' | 'Car')}
        options={[
          {
            value: 'Bike',
            label: 'Bike',
            description: 'Own motorbike or scooter.',
          },
          { value: 'Car', label: 'Car', description: 'Own car.' },
        ]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Model" required hint="e.g. Honda CB Shine 125">
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model name"
          />
        </Field>
        <Field label="Fuel type" required>
          <Select value={fuelType} onValueChange={setFuelType}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {policy.fuelTypes.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Kilometres per litre"
          required
          hint="How far this vehicle goes on one litre."
        >
          <Input
            type="number"
            min={0}
            value={mileage || ''}
            onChange={(e) => setMileage(Number(e.target.value))}
          />
        </Field>
      </div>

      <Field label="Vehicle photo">
        <div className="space-y-3">
          <Notice
            tone="warn"
            items={[
              'Upload a photo of your vehicle with the number plate clearly visible. You can edit or update these details later if anything changes.',
            ]}
          />
          {imageLink ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm">
              <a
                href={imageLink}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate font-medium hover:underline"
              >
                {imageName || 'Photo attached'}
              </a>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  setImageLink('');
                  setImageName('');
                }}
                aria-label="Remove photo"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-muted px-6 py-6 text-center hover:bg-accent">
              {uploading ? (
                <Loader2
                  size={18}
                  className="animate-spin text-muted-foreground"
                />
              ) : (
                <FileUp size={18} className="text-muted-foreground" />
              )}
              <span className="text-sm font-medium text-muted-foreground">
                {uploading ? 'Uploading…' : 'Choose a photo'}
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={!uploadEnabled || uploading}
                onChange={(e) => {
                  acceptImage(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </Field>

      {error && <Notice tone="error" items={[error]} />}
      <Button
        type="button"
        disabled={
          busy || uploading || !model.trim() || !fuelType || !(mileage > 0)
        }
        onClick={submit}
      >
        {busy && <Loader2 size={16} className="animate-spin" />} Submit for
        approval
      </Button>
    </div>
  );
}
