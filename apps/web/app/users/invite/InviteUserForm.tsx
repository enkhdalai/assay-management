"use client";

import { FormEvent, useState } from "react";

type CreatedInvitation = {
  email: string;
  role: string;
  token: string;
  expiresAt: string;
};

export function InviteUserForm({ isSuperAdmin = false, organizationId }: { isSuperAdmin?: boolean; organizationId?: string }) {
  const [error, setError] = useState("");
  const [invitation, setInvitation] = useState<CreatedInvitation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inviteUrl = invitation
    ? `${typeof window === "undefined" ? "" : window.location.origin}/invite?token=${invitation.token}`
    : "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInvitation(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          role: form.get("role"),
          expiresInDays: Number(form.get("expiresInDays") ?? 7),
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

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <label>
        <span>Имэйл</span>
        <input autoComplete="email" inputMode="email" name="email" required type="email" />
      </label>
      <label>
        <span>Эрх</span>
        <select defaultValue="intake_officer" name="role" required>
          <option value="intake_officer">Хайлагч</option>
          <option value="chemist">Химич</option>
          {isSuperAdmin ? <option value="lab_manager">Лабораторийн эрхлэгч</option> : null}
        </select>
      </label>
      <label>
        <span>Хүчинтэй хоног</span>
        <input defaultValue="7" max="30" min="1" name="expiresInDays" required type="number" />
      </label>

      {error ? <p className="login-error">{error}</p> : null}

      {invitation ? (
        <div className="invite-result">
          <strong>Урилга үүссэн</strong>
          <span>{invitation.email}</span>
          <code>{inviteUrl}</code>
        </div>
      ) : null}

      <button className="primary-button login-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Үүсгэж байна..." : "Урилга үүсгэх"}
      </button>
    </form>
  );
}
