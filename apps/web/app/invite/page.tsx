import type { Metadata } from "next";

import { AcceptInviteForm } from "./AcceptInviteForm";

export const metadata: Metadata = {
  title: "Урилга баталгаажуулах | Сорьцын төвийн удирдлага",
  description: "Сорьцын төвийн системийн хэрэглэгчийн урилгыг баталгаажуулах.",
};

type InvitePageProps = {
  searchParams?: Promise<{
    token?: string;
  }>;
};

export default async function InvitePage({ searchParams }: InvitePageProps) {
  const params = await searchParams;
  const token = typeof params?.token === "string" ? params.token : "";

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="invite-title">
        <div className="brand-block login-brand">
          <div className="brand-mark">AC</div>
          <div>
            <strong>Сорьцын төв</strong>
            <span>Хэрэглэгчийн урилга</span>
          </div>
        </div>

        <div className="login-copy">
          <p className="eyebrow">Урилга</p>
          <h1 id="invite-title">Бүртгэлээ идэвхжүүлэх</h1>
          <p>Урилгын холбоосоор нэвтрэх эрхээ баталгаажуулж, шинэ нууц үг үүсгэнэ.</p>
        </div>

        {token ? (
          <AcceptInviteForm token={token} />
        ) : (
          <p className="login-error">Урилгын token олдсонгүй.</p>
        )}
      </section>

      <aside className="login-security-panel">
        <p className="eyebrow">Нууцлал</p>
        <h2>Энэ системд public signup байхгүй.</h2>
        <ul className="check-list">
          <li>Зөвхөн эрхтэй админ хэрэглэгч урилга үүсгэнэ.</li>
          <li>Урилгын token зөвхөн hash хэлбэрээр хадгалагдана.</li>
          <li>Хугацаа дууссан урилга дахин ашиглагдахгүй.</li>
        </ul>
      </aside>
    </main>
  );
}
