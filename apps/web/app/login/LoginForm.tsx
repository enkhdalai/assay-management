"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type LoginFormProps = {
  returnTo: string;
};

export function LoginForm({ returnTo }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        const requestId =
          typeof result?.requestId === "string" ? ` (Support ID: ${result.requestId})` : "";
        const code = typeof result?.code === "string" ? ` [${result.code}]` : "";
        setError(`${result?.message ?? "Нэвтрэх үед алдаа гарлаа."}${requestId}${code}`);
        return;
      }

      window.location.assign(returnTo);
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
        <input
          autoComplete="email"
          inputMode="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>

      <label>
        <span>Нууц үг</span>
        <span className="password-field">
          <input
            autoComplete="current-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type={isPasswordVisible ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={isPasswordVisible ? "Нууц үгийг нуух" : "Нууц үгийг харуулах"}
            aria-pressed={isPasswordVisible}
            className="password-visibility-toggle"
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            title={isPasswordVisible ? "Нууц үгийг нуух" : "Нууц үгийг харуулах"}
            type="button"
          >
            {isPasswordVisible ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}
          </button>
        </span>
      </label>

      {error ? <p className="login-error">{error}</p> : null}

      <button className="primary-button login-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Шалгаж байна..." : "Нэвтрэх"}
      </button>
    </form>
  );
}
