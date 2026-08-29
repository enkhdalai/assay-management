"use client";

import { useState } from "react";

export function LogoutButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function logout() {
    setIsSubmitting(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/login");
  }

  return (
    <button
      aria-label="Гарах"
      className="logout-button"
      disabled={isSubmitting}
      onClick={logout}
      type="button"
    >
      {isSubmitting ? "..." : "Гарах"}
    </button>
  );
}
