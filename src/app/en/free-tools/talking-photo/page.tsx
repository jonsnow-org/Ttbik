import TalkingPhoto from "@/app/free-tools/talking-photo/TalkingPhoto";
import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";

export const metadata = enToolMetadata("talking-photo");

export default function TalkingPhotoEnPage() {
  return (
    <EnToolPage slug="talking-photo">
      <TalkingPhoto lang="en" />
      <section className="mt-8 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm leading-7 text-slate-600">
        <h2 className="mb-2 text-base font-extrabold text-slate-900">Use it responsibly</h2>
        <p>
          Use pictures you own, fictional characters, or pictures of people who allowed it.
          Do not impersonate anyone or use the video to deceive or abuse. Every video carries
          an “AI-generated” mark.
        </p>
      </section>
    </EnToolPage>
  );
}
