import Link from "next/link";
import ExploreMore from "@/components/ExploreMore";
import ShareRow from "@/components/ShareRow";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ShareRow />
      <p className="mx-auto max-w-4xl px-4 pt-4 text-sm" dir="rtl">
        <Link href="/prayer-widget" className="font-bold text-indigo-700 hover:underline">
          🧩 ضع مواقيت مدينتك في موقعك مجاناً — كود تضمين جاهز ←
        </Link>
      </p>
      <ExploreMore from="prayer" />
    </>
  );
}
