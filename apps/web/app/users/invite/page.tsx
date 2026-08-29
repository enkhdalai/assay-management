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
        <div className="brand-block login-brand">
          <div className="brand-mark">AC</div>
          <div>
            <strong>Сорьцын төв</strong>
            <span>Хэрэглэгчийн эрх</span>
          </div>
        </div>

        <div className="login-copy">
          <p className="eyebrow">Админ хэсэг</p>
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
          <li>Сорьцын төвийн админ зөвхөн өөрийн байгууллагад хэрэглэгч урьж чадна.</li>
          <li>System admin бүх байгууллагын хэрэглэгчийг удирдана.</li>
          <li>Арилжааны банкны хэрэглэгч зөвхөн өөрт хуваарилсан мэдээлэл харна.</li>
        </ul>
      </aside>
    </main>
  );
}
