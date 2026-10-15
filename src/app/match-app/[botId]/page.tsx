import type { Metadata } from "next";
import MatchMiniApp from "./MatchMiniApp";

export const metadata: Metadata = { title: "تطبيق التعارف والزواج", robots: { index: false, follow: false } };

export default async function Page(props: { params: Promise<{ botId: string }> }) {
  const { botId } = await props.params;
  return <MatchMiniApp botId={botId} />;
}
