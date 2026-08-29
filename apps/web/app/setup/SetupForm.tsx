"use client";

import { FormEvent, useState } from "react";

export function SetupForm() {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const response = await fetch("/api/setup/first-admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        setError(result?.message ?? "Эхний админ үүсгэх үед алдаа гарлаа.");
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
        <span>Setup token</span>
        <input autoComplete="off" name="setupToken" required type="password" />
      </label>
      <label>
        <span>Байгууллагын нэр</span>
        <input name="organizationName" required type="text" />
      </label>
      <label>
        <span>Байгууллагын код</span>
        <input name="organizationCode" required type="text" />
      </label>
      <label>
        <span>Админы овог нэр</span>
        <input autoComplete="name" name="fullName" required type="text" />
      </label>
      <label>
        <span>Админы имэйл</span>
        <input autoComplete="email" inputMode="email" name="email" required type="email" />
      </label>
      <label>
        <span>Нууц үг</span>
        <input autoComplete="new-password" name="password" required type="password" />
      </label>

      {error ? <p className="login-error">{error}</p> : null}

      <button className="primary-button login-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Үүсгэж байна..." : "Эхний админ үүсгэх"}
      </button>
    </form>
  );
}
