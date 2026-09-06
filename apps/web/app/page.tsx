import type { Metadata } from "next";

import { OperationalWorkspace } from "./OperationalWorkspace";

export const metadata: Metadata = {
  title: "Сорьцын төвийн удирдлага",
  description:
    "Алт, мөнгөний сорьцын бүртгэл, банкны хуваарилалт, Монголбанкны баталгаажуулалтын хувийн удирдлагын систем.",
};

export default function Home() {
  return <OperationalWorkspace />;
}
