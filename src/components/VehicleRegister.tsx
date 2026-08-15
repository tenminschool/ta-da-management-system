import { useEffect, useState } from "react";
import { FileUp, Loader2, Trash2 } from "lucide-react";
import { api } from "../api.js";
import type { Policy, VehicleRegistration } from "../../shared/types.js";
import { Card, ChoiceGrid, Field, Notice, Spinner } from "./ui.js";

/**
 * The registration form itself — shared by the standalone "Register your
 * Vehicle" page and the Personal Vehicle step inside a claim, so registering
 * from either place behaves identically and stays in sync.
 */
export function VehicleRegisterForm({
  policy, initial, onSubmitted,
}: {
  policy: Policy;
  initial?: VehicleRegistration | null;
  onSubmitted: (v: VehicleRegistration) => void;
}) {
  const [vehicleType, setVehicleType] = useState<"Bike" | "Car">(initial?.vehicleType || "Bike");
  const [model, setModel] = useState(initial?.model || "");
  const [fuelType, setFuelType] = useState(initial?.fuelType || policy.fuelTypes[0]?.value || "");
  const [mileage, setMileage] = useState(initial?.mileageKmPerLitre || 0);
  const [imageLink, setImageLink] = useState(initial?.imageLink || "");
  const [imageName, setImageName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [maxBytes, setMaxBytes] = useState(50 * 1024 * 1024);
  const [uploadEnabled, setUploadEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.uploadConfig()
      .then((c) => { setUploadEnabled(c.enabled); setMaxBytes(c.maxBytes); })
      .catch(() => {});
  }, []);

  async function acceptImage(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setError("");
    if (file.size > maxBytes) {
      setError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
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
    setError("");
    try {
      const { vehicle } = await api.registerVehicle({
        vehicleType, model: model.trim(), fuelType, mileageKmPerLitre: mileage, imageLink,
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
        onChange={(v) => setVehicleType(v as "Bike" | "Car")}
        options={[
          { value: "Bike", label: "Bike", description: "Own motorbike or scooter." },
          { value: "Car", label: "Car", description: "Own car." },
        ]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Model" required hint="e.g. Honda CB Shine 125">
          <input className="field" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name" />
        </Field>
        <Field label="Fuel type" required>
          <select className="field" value={fuelType} onChange={(e) => setFuelType(e.target.value)}>
            <option value="">Select</option>
            {policy.fuelTypes.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Kilometres per litre" required hint="How far this vehicle goes on one litre.">
          <input
            type="number"
            min={0}
            className="field"
            value={mileage || ""}
            onChange={(e) => setMileage(Number(e.target.value))}
          />
        </Field>
      </div>

      <Field label="Vehicle photo">
        <div className="space-y-3">
          <Notice
            tone="warn"
            items={[
              "Upload a photo of your vehicle with the number plate clearly visible. You can edit or update these details later if anything changes.",
            ]}
          />
          {imageLink ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-2.5 text-sm">
              <a href={imageLink} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-slate-700 hover:underline">
                {imageName || "Photo attached"}
              </a>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                onClick={() => { setImageLink(""); setImageName(""); }}
                aria-label="Remove photo"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-6 text-center hover:bg-slate-100">
              {uploading ? <Loader2 size={18} className="animate-spin text-slate-400" /> : <FileUp size={18} className="text-slate-400" />}
              <span className="text-sm font-medium text-slate-600">{uploading ? "Uploading…" : "Choose a photo"}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={!uploadEnabled || uploading}
                onChange={(e) => { acceptImage(e.target.files); e.target.value = ""; }}
              />
            </label>
          )}
        </div>
      </Field>

      {error && <Notice tone="error" items={[error]} />}
      <button
        type="button"
        className="btn-primary"
        disabled={busy || uploading || !model.trim() || !fuelType || !(mileage > 0)}
        onClick={submit}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : null} Submit for approval
      </button>
    </div>
  );
}

/**
 * The standalone "Register your Vehicle" page — reachable from the main
 * nav, not just from a Personal Vehicle claim, so someone can get approved
 * ahead of time and have their vehicle auto-selected the first time they
 * actually file a claim.
 */
export default function VehicleRegisterPage({ policy }: { policy: Policy }) {
  const [myVehicle, setMyVehicle] = useState<VehicleRegistration | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api.myVehicle().then((r) => setMyVehicle(r.vehicle)).catch(() => setMyVehicle(null));
  }, []);

  const submitted = (v: VehicleRegistration) => { setEditing(false); setMyVehicle(v); };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900 sm:text-xl">Register your vehicle</h1>
        <p className="mt-1 text-sm text-slate-500">
          Register here ahead of time and it is ready the moment you file a Personal Vehicle claim — nothing left to fill in there.
        </p>
      </div>

      {myVehicle === undefined ? (
        <Card>
          <Spinner label="Checking your vehicle registration…" />
        </Card>
      ) : editing || !myVehicle || myVehicle.status === "rejected" ? (
        <Card
          title={myVehicle ? "Update your vehicle" : "Register your vehicle"}
          subtitle="Reimbursement is worked out from your own vehicle's mileage, once HR or Admin approves it. One registration covers every personal-vehicle claim after that."
        >
          {myVehicle?.status === "rejected" && (
            <div className="mb-4">
              <Notice
                tone="error"
                items={[`Not approved${myVehicle.reviewNote ? ` — ${myVehicle.reviewNote}` : ""}. Update the details and submit again.`]}
              />
            </div>
          )}
          <VehicleRegisterForm policy={policy} initial={myVehicle} onSubmitted={submitted} />
        </Card>
      ) : myVehicle.status === "pending" ? (
        <Card title="Personal vehicle" subtitle="Waiting on HR or Admin to approve this before it can be claimed against.">
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <p className="font-medium text-slate-800">{myVehicle.vehicleType} — {myVehicle.model}</p>
            <p className="mt-0.5">{myVehicle.fuelType} · {myVehicle.mileageKmPerLitre} km per litre</p>
            {myVehicle.imageLink && (
              <a href={myVehicle.imageLink} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-xs font-semibold text-brand-600 hover:underline">
                View uploaded photo
              </a>
            )}
            <p className="mt-1.5 text-xs text-slate-400">
              Submitted {myVehicle.submittedAt ? new Date(myVehicle.submittedAt).toLocaleDateString() : "—"}
            </p>
          </div>
        </Card>
      ) : (
        <Card
          title="Personal vehicle"
          subtitle={`${myVehicle.vehicleType} — ${myVehicle.model} · ${myVehicle.fuelType}, ${myVehicle.mileageKmPerLitre} km/l. Approved by HR/Admin.`}
        >
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
            {myVehicle.imageLink ? (
              <a href={myVehicle.imageLink} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
                View vehicle photo
              </a>
            ) : (
              <p className="text-slate-400">No photo on file — add one below.</p>
            )}
          </div>
          <button type="button" className="mt-4 text-xs font-semibold text-brand-600 hover:underline" onClick={() => setEditing(true)}>
            Update vehicle details
          </button>
        </Card>
      )}
    </div>
  );
}
