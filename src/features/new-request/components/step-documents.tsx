'use client';

import { useEffect, useState } from 'react';
import { FileText, FileUp, Loader2, Trash2 } from 'lucide-react';
import { Button, Input, Textarea } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import type { RequestDraft, SessionUser } from '@/shared/types';
import { Card, ChoiceGrid, Field, MultiSelect, Notice } from '@/components/ui';

interface Upload {
  name: string;
  link: string;
  sizeBytes: number;
}

export function StepDocuments({
  draft,
  set,
  documentTypes,
  payable,
  currency,
  bankAllowed,
  needsReceipt,
  user,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  documentTypes: string[];
  payable: number;
  currency: string;
  bankAllowed: boolean;
  /** False for a rickshaw fare or a personal-vehicle claim — neither issues one. */
  needsReceipt: boolean;
  user: SessionUser;
}) {
  // Names are only known for files uploaded in this session; a claim being
  // edited comes back with links alone, so those fall back to the URL.
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [progress, setProgress] = useState<{ name: string; pct: number }[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [maxBytes, setMaxBytes] = useState(50 * 1024 * 1024);
  const [enabled, setEnabled] = useState(true);
  const [dragging, setDragging] = useState(false);
  // Nothing to attach for a rickshaw fare or a personal-vehicle trip, so the
  // picker starts hidden rather than merely optional — an empty required-look
  // upload box was the thing people kept asking about. One click brings it
  // back for anyone who genuinely wants to attach something anyway.
  const [showUploader, setShowUploader] = useState(needsReceipt);

  // Whatever is on the employee record right now — starts open for editing
  // until there is something saved, then locks so it reads as confirmed
  // rather than as a field still waiting to be filled in.
  const [savedBkash, setSavedBkash] = useState(user.accountNumber || '');
  const [editingBkash, setEditingBkash] = useState(!savedBkash);
  const [savingBkash, setSavingBkash] = useState(false);
  const [bkashSaveError, setBkashSaveError] = useState('');

  async function saveBkash() {
    setSavingBkash(true);
    setBkashSaveError('');
    try {
      const { bkashNumber } = await api.saveBkashNumber(draft.bkashNumber);
      setSavedBkash(bkashNumber);
      setEditingBkash(false);
    } catch (err) {
      setBkashSaveError((err as Error).message);
    } finally {
      setSavingBkash(false);
    }
  }

  // Saving a teammate's number here writes it to their own record, so it's
  // there next time without retyping it — they can still open their own
  // claim form and correct it themselves (the same field/button above, just
  // for their own account instead of someone else's).
  const [savingTeammateId, setSavingTeammateId] = useState('');
  const [teammateSaved, setTeammateSaved] = useState<Record<string, boolean>>(
    {},
  );
  const [teammateSaveError, setTeammateSaveError] = useState<
    Record<string, string>
  >({});

  async function saveTeammateBkash(employeeId: string, bkashNumber: string) {
    setSavingTeammateId(employeeId);
    setTeammateSaveError((e) => ({ ...e, [employeeId]: '' }));
    try {
      await api.saveTeammateBkash(employeeId, bkashNumber);
      setTeammateSaved((s) => ({ ...s, [employeeId]: true }));
    } catch (err) {
      setTeammateSaveError((e) => ({
        ...e,
        [employeeId]: (err as Error).message,
      }));
    } finally {
      setSavingTeammateId('');
    }
  }

  // Shared by the individual and team layouts — both ask for the submitter's
  // own number, just inside a differently-titled card.
  function myBkashField(required: boolean) {
    if (!editingBkash && savedBkash) {
      return (
        <Field label="Give your personal bKash number" required={required}>
          <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input px-3 text-sm">
            <span className="font-mono">{savedBkash}</span>
            <button
              type="button"
              className="shrink-0 text-xs font-semibold text-primary hover:underline"
              onClick={() => setEditingBkash(true)}
            >
              Edit
            </button>
          </div>
        </Field>
      );
    }
    return (
      <Field
        label="Give your personal bKash number"
        required={required}
        hint="11 digits starting with 01."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={14}
            placeholder="01712345678"
            value={draft.bkashNumber}
            onChange={(e) => set({ bkashNumber: e.target.value })}
          />
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 whitespace-nowrap text-xs"
            disabled={savingBkash || !draft.bkashNumber.trim()}
            onClick={saveBkash}
          >
            {savingBkash && <Loader2 size={14} className="animate-spin" />} Save
            this bKash number
          </Button>
        </div>
        {bkashSaveError && (
          <p className="mt-1.5 text-xs text-destructive">{bkashSaveError}</p>
        )}
      </Field>
    );
  }

  useEffect(() => {
    api
      .uploadConfig()
      .then((c) => {
        setEnabled(c.enabled);
        setMaxBytes(c.maxBytes);
      })
      .catch(() => {});
  }, []);

  const maxMB = Math.round(maxBytes / 1024 / 1024);
  const mb = (n: number) =>
    `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;
  const nameFor = (link: string) =>
    uploads.find((u) => u.link === link)?.name || link;

  async function accept(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    setErrors([]);

    const tooBig = files.filter((f) => f.size > maxBytes);
    if (tooBig.length) {
      setErrors(
        tooBig.map(
          (f) => `${f.name} is ${mb(f.size)} — the limit is ${maxMB} MB.`,
        ),
      );
    }
    const queue = files.filter((f) => f.size <= maxBytes);
    if (!queue.length) return;

    setProgress(queue.map((f) => ({ name: f.name, pct: 0 })));

    // Sequential on purpose: several 50 MB files at once would fight for
    // bandwidth and make every progress bar crawl.
    for (const file of queue) {
      try {
        const saved = await api.upload(
          file,
          draft.documentLinks.length + uploads.length,
          (fraction) => {
            setProgress((p) =>
              p.map((x) =>
                x.name === file.name
                  ? { ...x, pct: Math.round(fraction * 100) }
                  : x,
              ),
            );
          },
        );
        setUploads((u) => [
          ...u,
          { name: saved.name, link: saved.link, sizeBytes: saved.sizeBytes },
        ]);
        set({ documentLinks: [...draft.documentLinks, saved.link] });
        draft = {
          ...draft,
          documentLinks: [...draft.documentLinks, saved.link],
        };
      } catch (err) {
        setErrors((e) => [...e, `${file.name}: ${(err as Error).message}`]);
      } finally {
        setProgress((p) => p.filter((x) => x.name !== file.name));
      }
    }
  }

  function remove(link: string) {
    set({ documentLinks: draft.documentLinks.filter((l) => l !== link) });
    setUploads((u) => u.filter((x) => x.link !== link));
  }

  return (
    <>
      <Card
        title="Documents"
        subtitle={
          needsReceipt || showUploader
            ? 'Attach tickets, bills, receipts, invoices, hotel bills or approval mail. Files are stored in the shared Drive and renamed with your employee ID, name and date.'
            : 'Not required for this claim.'
        }
      >
        <div className="space-y-4">
          {!needsReceipt && !showUploader && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Nothing to attach — a rickshaw fare or a personal-vehicle trip
                has no receipt.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setShowUploader(true)}
              >
                Attach something anyway
              </Button>
            </div>
          )}

          {(needsReceipt || showUploader) && (
            <>
              {!needsReceipt && (
                <Notice
                  tone="info"
                  items={[
                    'Still not required for this claim — attach one only if you have something worth keeping on file.',
                  ]}
                />
              )}
              <Field
                label="Document types"
                required={needsReceipt}
                hint="Pick every type your files cover — you can select more than one."
              >
                <MultiSelect
                  options={documentTypes}
                  value={draft.documentTypes}
                  onChange={(documentTypes) => set({ documentTypes })}
                  placeholder="Select document types…"
                />
              </Field>

              {!enabled && (
                <Notice
                  tone="warn"
                  items={[
                    'File uploads are not configured on this deployment — DRIVE_FOLDER_ID is not set.',
                  ]}
                />
              )}

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  accept(e.dataTransfer.files);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
                  dragging
                    ? 'border-primary bg-primary/5'
                    : 'bg-muted hover:bg-accent'
                }`}
              >
                <FileUp size={22} className="text-muted-foreground" />
                <span className="text-sm font-semibold">
                  Choose files, or drag them here
                </span>
                <span className="text-xs text-muted-foreground">
                  Image, PDF, Word, Excel, CSV — any type · up to {maxMB} MB
                  each · pick as many as you need
                </span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  disabled={!enabled}
                  onChange={(e) => {
                    accept(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          )}

          {progress.length > 0 && (
            <ul className="space-y-2 rounded-xl border p-3">
              {progress.map((p) => (
                <li key={p.name}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {p.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {p.pct}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${p.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {errors.length > 0 && <Notice tone="error" items={errors} />}

          {draft.documentLinks.length > 0 && (
            <ul className="divide-y rounded-xl border">
              {draft.documentLinks.map((link) => {
                const up = uploads.find((u) => u.link === link);
                return (
                  <li
                    key={link}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm"
                  >
                    <FileText
                      size={15}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1">
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium hover:underline"
                      >
                        {nameFor(link)}
                      </a>
                      {up && (
                        <span className="text-xs text-muted-foreground">
                          {mb(up.sizeBytes)}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => remove(link)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Remove"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <Card
        title={
          draft.travelType === 'team'
            ? 'Where the payment goes'
            : 'Your personal bKash number'
        }
        subtitle={
          draft.travelType === 'team'
            ? `Team travel — each traveller is paid separately. ${draft.teamMembers.length + 1} numbers are needed.`
            : `Finance pays the approved amount here.${payable > 0 ? ` Right now that is ${currency} ${payable}.` : ''}`
        }
      >
        {/* Bank payment stays hidden until an administrator turns it on in
            Configuration, and bKash is simply the only option until then. */}
        {bankAllowed && (
          <div className="mb-5">
            <ChoiceGrid
              value={draft.payoutMethod}
              onChange={(payoutMethod) =>
                set({
                  payoutMethod: payoutMethod as RequestDraft['payoutMethod'],
                })
              }
              options={[
                {
                  value: 'bkash',
                  label: 'bKash',
                  description: 'Paid to your personal bKash number.',
                },
                {
                  value: 'bank',
                  label: 'Bank account',
                  description: 'Paid into your bank account.',
                },
              ]}
            />
          </div>
        )}

        {draft.travelType === 'team' && draft.payoutMethod !== 'bank' && (
          <div className="mb-5 space-y-3 rounded-xl bg-muted p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Team payout numbers
            </p>
            {myBkashField(payable > 0)}
            {draft.teamMembers.map((m, i) => (
              <Field
                key={m.employeeId || i}
                label={`${m.name || 'Team member ' + (i + 1)}'s bKash number`}
                required={payable > 0}
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={14}
                    placeholder="01712345678"
                    value={m.bkashNumber}
                    onChange={(e) => {
                      const teamMembers = draft.teamMembers.map((x, idx) =>
                        idx === i ? { ...x, bkashNumber: e.target.value } : x,
                      );
                      set({ teamMembers });
                      setTeammateSaved((s) => ({
                        ...s,
                        [m.employeeId]: false,
                      }));
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 whitespace-nowrap text-xs"
                    disabled={
                      savingTeammateId === m.employeeId || !m.bkashNumber.trim()
                    }
                    onClick={() =>
                      saveTeammateBkash(m.employeeId, m.bkashNumber)
                    }
                  >
                    {savingTeammateId === m.employeeId && (
                      <Loader2 size={14} className="animate-spin" />
                    )}{' '}
                    Save to their record
                  </Button>
                </div>
                {teammateSaveError[m.employeeId] && (
                  <p className="mt-1.5 text-xs text-destructive">
                    {teammateSaveError[m.employeeId]}
                  </p>
                )}
                {!teammateSaveError[m.employeeId] &&
                  teammateSaved[m.employeeId] && (
                    <p className="mt-1.5 text-xs text-emerald-600">
                      Saved to their record — they can still edit it themselves.
                    </p>
                  )}
              </Field>
            ))}
          </div>
        )}

        {draft.payoutMethod === 'bank' && bankAllowed ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank name" required={payable > 0}>
              <Input
                value={draft.bankName}
                onChange={(e) => set({ bankName: e.target.value })}
              />
            </Field>
            <Field
              label="Account name"
              required={payable > 0}
              hint="Exactly as the bank has it."
            >
              <Input
                value={draft.bankAccountName}
                onChange={(e) => set({ bankAccountName: e.target.value })}
              />
            </Field>
            <Field label="Account number" required={payable > 0}>
              <Input
                inputMode="numeric"
                value={draft.bankAccountNumber}
                onChange={(e) => set({ bankAccountNumber: e.target.value })}
              />
            </Field>
            <Field label="Routing number" required={payable > 0}>
              <Input
                inputMode="numeric"
                value={draft.bankRoutingNumber}
                onChange={(e) => set({ bankRoutingNumber: e.target.value })}
              />
            </Field>
            <Field label="Branch" required={payable > 0}>
              <Input
                value={draft.bankBranch}
                onChange={(e) => set({ bankBranch: e.target.value })}
              />
            </Field>
          </div>
        ) : (
          draft.travelType !== 'team' && myBkashField(payable > 0)
        )}
      </Card>

      <Card title="Note for the approvers">
        <Textarea
          className="min-h-24"
          value={draft.employeeNote}
          onChange={(e) => set({ employeeNote: e.target.value })}
          placeholder="Anything your line manager, Administration or Finance should know."
        />
      </Card>
    </>
  );
}
