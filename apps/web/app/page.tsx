import type { Metadata } from "next";

import { LogoutButton } from "./LogoutButton";

export const metadata: Metadata = {
  title: "Сорьцын төвийн удирдлага",
  description:
    "Алт, мөнгөний сорьцын бүртгэл, банкны хуваарилалт, Монголбанкны баталгаажуулалтын хувийн удирдлагын систем.",
};

const stats = [
  { label: "Идэвхтэй сорьц", value: "28", tone: "blue" },
  { label: "Баталгаажуулах", value: "7", tone: "amber" },
  { label: "Банкуудад илгээсэн", value: "16", tone: "green" },
  { label: "Түгжээтэй бичилт", value: "42", tone: "slate" },
];

const workflow = [
  { label: "Хүлээн авсан", count: 8 },
  { label: "Шинжилгээнд", count: 6 },
  { label: "Эрхлэгч хянах", count: 7 },
  { label: "Монголбанк руу", count: 4 },
  { label: "Банк хүлээн авсан", count: 3 },
];

const assayRecords = [
  {
    id: "AC-260820-014",
    customer: "Б. Энхбат",
    metal: "Алт",
    weight: "126.45 гр",
    purity: "89.72%",
    fineWeight: "113.45 гр",
    banks: "Хаан 70 гр, Голомт 56.45 гр",
    status: "Эрхлэгч хянах",
  },
  {
    id: "AC-260820-013",
    customer: "Очир Эрдэнэ ХХК",
    metal: "Мөнгө",
    weight: "412.00 гр",
    purity: "92.10%",
    fineWeight: "379.45 гр",
    banks: "Төрийн банк 412 гр",
    status: "Монголбанк илгээсэн",
  },
  {
    id: "AC-260820-012",
    customer: "Д. Номин",
    metal: "Алт",
    weight: "48.30 гр",
    purity: "91.35%",
    fineWeight: "44.13 гр",
    banks: "Хас банк 20 гр, ХХБ 28.3 гр",
    status: "Банк хуваарилсан",
  },
];

const bankAccess = [
  { bank: "Хаан банк", records: 9, grams: "342.60 гр", permission: "Зөвхөн өөрт хуваарилсан" },
  { bank: "Голомт банк", records: 5, grams: "188.45 гр", permission: "Зөвхөн унших" },
  { bank: "ХХБ", records: 4, grams: "91.10 гр", permission: "Баталгаажсан дүн" },
  { bank: "Төрийн банк", records: 3, grams: "412.00 гр", permission: "Баталгаажсан дүн" },
  { bank: "Хас банк", records: 2, grams: "36.80 гр", permission: "Зөвхөн унших" },
];

const auditEvents = [
  "AC-260820-014 сорьцын жинг бүртгэж, өөрчлөлтийн шалтгаан хадгаллаа.",
  "AC-260820-012 дээр Хас банкны 20 гр хуваарилалтыг түгжлээ.",
  "Монголбанк API хүсэлтийн гарын үсгийг амжилттай шалгав.",
  "Лабораторийн эрхлэгч AC-260820-011 дүнг баталгаажуулав.",
];

const navigationItems = [
  { label: "Хяналтын самбар", href: "/" },
  { label: "Сорьцын бүртгэл", href: "#" },
  { label: "Харилцагчид", href: "#" },
  { label: "Шинжилгээний дүн", href: "#" },
  { label: "Банк хуваарилалт", href: "#" },
  { label: "Монголбанк API", href: "#" },
  { label: "Арилжааны банкууд", href: "#" },
  { label: "Тайлан", href: "#" },
  { label: "Аудит лог", href: "#" },
  { label: "Хэрэглэгч урих", href: "/users/invite" },
  { label: "Тохиргоо", href: "#" },
];

export default function Home() {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Үндсэн цэс">
        <div className="brand-block">
          <div className="brand-mark">AC</div>
          <div>
            <strong>Сорьцын төв</strong>
            <span>Хувийн удирдлага</span>
          </div>
        </div>

        <nav className="nav-list">
          {navigationItems.map((item, index) => (
            <a className={index === 0 ? "nav-item active" : "nav-item"} href={item.href} key={item.label}>
              <span className="nav-icon">{item.label.slice(0, 1)}</span>
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Алт, мөнгөний сорьцын бүртгэл</p>
            <h1>Сорьцын төвийн удирдлага</h1>
          </div>
          <div className="top-actions">
            <button aria-label="Тусламж">?</button>
            <button aria-label="Мэдэгдэл">!</button>
            <div className="user-menu">Админ хэрэглэгч</div>
            <LogoutButton />
          </div>
        </header>

        <section className="stats-grid" aria-label="Товч үзүүлэлтүүд">
          {stats.map((item) => (
            <article className={`stat-card ${item.tone}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </section>

        <section className="dashboard-grid">
          <article className="panel wide">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Өнөөдрийн ажилбар</p>
                <h2>Сорьцын урсгал</h2>
              </div>
              <button className="primary-button">Шинэ сорьц бүртгэх</button>
            </div>
            <div className="workflow">
              {workflow.map((step) => (
                <div className="workflow-step" key={step.label}>
                  <strong>{step.count}</strong>
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-header compact">
              <div>
                <p className="eyebrow">Хамгаалалт</p>
                <h2>Өгөгдлийн бүрэн бүтэн байдал</h2>
              </div>
            </div>
            <ul className="check-list">
              <li>Баталгаажсан дүнг шууд засахгүй, шинэ хувилбар үүсгэнэ.</li>
              <li>Жин, сорьц, банкны хуваарилалт бүр аудит логтой.</li>
              <li>Оруулсан хэрэглэгч өөрөө эцсийн батлахгүй.</li>
            </ul>
          </article>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Шүүлтүүр</p>
              <h2>Сорьцын бүртгэл</h2>
            </div>
            <div className="filter-row">
              <select aria-label="Төлөв">
                <option>Бүх төлөв</option>
                <option>Шинжилгээнд</option>
                <option>Эрхлэгч хянах</option>
              </select>
              <select aria-label="Металл">
                <option>Алт, мөнгө</option>
                <option>Алт</option>
                <option>Мөнгө</option>
              </select>
              <input aria-label="Хайлт" placeholder="№, харилцагч, банкаар хайх" />
            </div>
          </div>

          <div className="record-table" role="table" aria-label="Сорьцын бүртгэл">
            <div className="table-row table-head" role="row">
              <span>№</span>
              <span>Харилцагч</span>
              <span>Металл</span>
              <span>Жин</span>
              <span>Сорьц</span>
              <span>Цэвэр жин</span>
              <span>Банкны хуваарилалт</span>
              <span>Төлөв</span>
            </div>
            {assayRecords.map((record) => (
              <div className="table-row" role="row" key={record.id}>
                <strong>{record.id}</strong>
                <span>{record.customer}</span>
                <span>{record.metal}</span>
                <span>{record.weight}</span>
                <span>{record.purity}</span>
                <span>{record.fineWeight}</span>
                <span>{record.banks}</span>
                <span className="status-pill">{record.status}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-grid bottom">
          <article className="panel">
            <div className="panel-header compact">
              <div>
                <p className="eyebrow">Арилжааны банк</p>
                <h2>Унших эрхийн хязгаарлалт</h2>
              </div>
            </div>
            <div className="bank-list">
              {bankAccess.map((bank) => (
                <div className="bank-item" key={bank.bank}>
                  <div>
                    <strong>{bank.bank}</strong>
                    <span>{bank.permission}</span>
                  </div>
                  <div>
                    <strong>{bank.records}</strong>
                    <span>{bank.grams}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-header compact">
              <div>
                <p className="eyebrow">Монголбанк</p>
                <h2>API солилцоо</h2>
              </div>
              <span className="live-badge">Идэвхтэй</span>
            </div>
            <div className="api-box">
              <code>/api/v1/assays</code>
              <p>Баталгаажсан сорьц, банкны хуваарилалт, дүнгийн хувилбарыг гарын үсэгтэй хүсэлтээр дамжуулна.</p>
            </div>
            <ul className="check-list">
              <li>API түлхүүр болон IP зөвшөөрөлтэй.</li>
              <li>Давхар илгээхээс хамгаалах idempotency түлхүүртэй.</li>
              <li>Үнэ, тооцоолол нь тусдаа баталгаажуулалтын бичилттэй.</li>
            </ul>
          </article>

          <article className="panel">
            <div className="panel-header compact">
              <div>
                <p className="eyebrow">Аудит</p>
                <h2>Сүүлийн үйлдлүүд</h2>
              </div>
            </div>
            <ol className="audit-list">
              {auditEvents.map((event) => (
                <li key={event}>{event}</li>
              ))}
            </ol>
          </article>
        </section>
      </section>
    </main>
  );
}
