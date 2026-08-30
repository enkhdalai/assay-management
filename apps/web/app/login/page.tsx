import type { Metadata } from "next";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Нэвтрэх | Сорьцын төвийн удирдлага",
  description: "Сорьцын төвийн хувийн удирдлагын системд нэвтрэх.",
};

type LoginPageProps = {
  searchParams?: Promise<{
    return_to?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params?.return_to);

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-block login-brand">
          <div className="brand-mark">
            <img alt="" src="/favicon.svg" />
          </div>
          <div>
            <strong>Сорьцын төв</strong>
            <span>Хувийн удирдлага</span>
          </div>
        </div>

        <div className="login-copy">
          <p className="eyebrow">Нэвтрэх хэсэг</p>
          <h1 id="login-title">Системд нэвтрэх</h1>
          <p>
            Алт, мөнгөний сорьцын мэдээлэл, банкны хуваарилалт, Монголбанкны
            баталгаажуулалттай холбоотой өгөгдөлд зөвхөн эрхтэй хэрэглэгч
            нэвтэрнэ.
          </p>
        </div>

        <LoginForm returnTo={returnTo} />
      </section>

      <aside className="login-security-panel">
        <p className="eyebrow">Хамгаалалт</p>
        <h2>Үнэ, жин, сорьцын өөрчлөлт бүр аудиттай.</h2>
        <ul className="check-list">
          <li>Нууц үгийг PBKDF2-SHA256 алгоритмаар hash хэлбэрээр хадгална.</li>
          <li>Session token зөвхөн hash хэлбэрээр шалгагдана.</li>
          <li>Cookie нь HTTP-only, SameSite хамгаалалттай.</li>
        </ul>
      </aside>
    </main>
  );
}

function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const url = new URL(value, "https://assay.local");
    if (url.origin !== "https://assay.local") return "/";
    if (url.pathname === "/login") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
