"use client";

import { FormEvent, useState } from "react";
import { Check, Copy } from "lucide-react";

type CreatedInvitation = {
  email: string;
  role: string;
  token: string;
};

type OrganizationChoice = { id: string; name: string };

export function InviteUserForm({ isSuperAdmin = false, organizationId, organizations = [], onOrganizationChange }: {
  isSuperAdmin?: boolean;
  organizationId?: string;
  organizations?: OrganizationChoice[];
  onOrganizationChange?(organizationId: string): void;
}) {
  const [error, setError] = useState("");
  const [invitation, setInvitation] = useState<CreatedInvitation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const inviteUrl = invitation
    ? `${typeof window === "undefined" ? "" : window.location.origin}/invite?token=${invitation.token}`
    : "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInvitation(null);
    setCopied(false);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          role: form.get("role"),
          organizationId,
        }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        setError(result?.message ?? "Урилга үүсгэх үед алдаа гарлаа.");
        return;
      }

      setInvitation(result.invitation);
    } catch {
      setError("Сүлжээний холболтыг шалгаад дахин оролдоно уу.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyInvitationUrl() {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(inviteUrl);
      else {
        const fallback = document.createElement("textarea");
        fallback.value = inviteUrl;
        fallback.style.position = "fixed";
        fallback.style.opacity = "0";
        document.body.append(fallback);
        fallback.select();
        document.execCommand("copy");
        fallback.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Урилгын холбоосыг хуулж чадсангүй.");
    }
  }

  return (
    <form className="login-form invite-form" onSubmit={handleSubmit}>
      <div className="invite-form-grid">
        {isSuperAdmin && <label className="invite-center-field">
          <span>Сорьцын төв</span>
          <select value={organizationId} onChange={(event) => onOrganizationChange?.(event.target.value)} required>
            {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
          </select>
        </label>}
        <label className="invite-email-field">
          <span>Имэйл хаяг</span>
          <input autoComplete="email" inputMode="email" name="email" placeholder="name@company.mn" required type="email" />
        </label>
        <label>
          <span>Эрх</span>
          <select defaultValue={isSuperAdmin ? "lab_manager" : "intake_officer"} name="role" required>
            {isSuperAdmin ? <option value="lab_manager">Лабораторийн эрхлэгч</option> : null}
            <option value="intake_officer">Хайлагч</option>
            <option value="chemist">Химич</option>
          </select>
        </label>
      </div>

      {error ? <p className="login-error">{error}</p> : null}

      {invitation ? (
        <div className="invite-result">
          <strong>Урилга үүссэн</strong>
          <span>{invitation.email}</span>
          <div className="invite-link-field">
            <input aria-label="Урилгын холбоос" readOnly value={inviteUrl} />
            <button className="secondary-button" type="button" title={copied ? "Хуулагдсан" : "Холбоос хуулах"} aria-label={copied ? "Хуулагдсан" : "Холбоос хуулах"} onClick={() => void copyInvitationUrl()}>{copied ? <Check size={18} /> : <Copy size={18} />}</button>
          </div>
        </div>
      ) : null}

      <button className="primary-button login-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Үүсгэж байна..." : "Урилга үүсгэх"}
      </button>
    </form>
  );
}
