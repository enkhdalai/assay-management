import type { Metadata } from "next";

import { SetupForm } from "./SetupForm";

export const metadata: Metadata = {
  title: "Эхний тохиргоо | Сорьцын төвийн удирдлага",
  description: "Системийн эхний супер админ хэрэглэгчийг хамгаалалттайгаар үүсгэх.",
};

export default function SetupPage() {
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="setup-title">
        <div className="brand-block login-brand">
          <div className="brand-mark">
            <img alt="" src="/favicon.svg" />
          </div>
          <div>
            <strong>Сорьцын төв</strong>
            <span>Эхний тохиргоо</span>
          </div>
        </div>

        <div className="login-copy">
          <p className="eyebrow">Bootstrap</p>
          <h1 id="setup-title">Эхний супер админ үүсгэх</h1>
          <p>
            Энэ хуудас зөвхөн хоосон өгөгдлийн сантай үед, сервер дээр
            тохируулсан setup token-оор ажиллана.
          </p>
        </div>

        <SetupForm />
      </section>

      <aside className="login-security-panel">
        <p className="eyebrow">Анхаарах зүйл</p>
        <h2>Setup token нь нэг удаагийн эхлэлийн хамгаалалт.</h2>
        <ul className="check-list">
          <li>Эхний хэрэглэгч супер админ эрхтэй үүснэ.</li>
          <li>Дараагийн хэрэглэгчид зөвхөн урилгаар нэмэгдэнэ.</li>
          <li>Setup token-ийг код эсвэл Git-д хадгалахгүй.</li>
        </ul>
      </aside>
    </main>
  );
}
