"use client";

import { FormEvent, useState } from "react";

type AcceptInviteFormProps = {
  token: string;
};

export function AcceptInviteForm({ token }: AcceptInviteFormProps) {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          fullName: form.get("fullName"),
          password: form.get("password"),
        }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        setError(result?.message ?? "Урилга баталгаажуулах үед алдаа гарлаа.");
        return;
      }

      window.location.assign("/");
    } catch {
      setError("Сүлжээний холболтыг шалгаад дахин оролдоно уу.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <label>
        <span>Овог нэр</span>
        <input autoComplete="name" name="fullName" required type="text" />
      </label>
      <label>
        <span>Шинэ нууц үг</span>
        <input autoComplete="new-password" name="password" required type="password" />
      </label>

      {error ? <p className="login-error">{error}</p> : null}

      <button className="primary-button login-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Баталгаажуулж байна..." : "Урилга баталгаажуулах"}
      </button>
    </form>
  );
}
