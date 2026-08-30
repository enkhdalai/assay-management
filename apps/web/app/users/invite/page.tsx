import type { Metadata } from "next";

import { InviteUserForm } from "./InviteUserForm";

export const metadata: Metadata = {
  title: "Хэрэглэгч урих | Сорьцын төвийн удирдлага",
  description: "Системд шинэ хэрэглэгч урих.",
};

export default function InviteUserPage() {
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="invite-user-title">
        <a className="back-link" href="/">
          <span aria-hidden="true">←</span>
          Хяналтын самбар руу буцах
        </a>

        <div className="brand-block login-brand">
          <div className="brand-mark">
            <img alt="" src="/favicon.svg" />
          </div>
          <div>
            <strong>Сорьцын төв</strong>
            <span>Хэрэглэгчийн эрх</span>
          </div>
        </div>

        <div className="login-copy">
          <p className="eyebrow">Супер админ / Админ хэсэг</p>
          <h1 id="invite-user-title">Хэрэглэгч урих</h1>
          <p>
            Урилгын холбоос нэг удаа буцаагдана. Үүнийг зөвхөн итгэмжлэгдсэн
            сувгаар тухайн хэрэглэгчид дамжуулна.
          </p>
        </div>

        <InviteUserForm />
      </section>

      <aside className="login-security-panel">
        <p className="eyebrow">Эрхийн загвар</p>
        <h2>Public signup байхгүй, хэрэглэгч бүр урилгаар орно.</h2>
        <ul className="check-list">
          <li>Супер админ бүх байгууллага, бүх хэрэглэгчийн эрхийг удирдана.</li>
          <li>Админ зөвхөн өөрийн сорьцын төвийн хэрэглэгчийг урьж, удирдана.</li>
          <li>Арилжааны банкны хэрэглэгч зөвхөн өөрт хуваарилсан мэдээлэл харна.</li>
        </ul>
      </aside>
    </main>
  );
}
