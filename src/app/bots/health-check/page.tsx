import type { Metadata } from "next";
import HealthCheckForm from "./HealthCheckForm";

export const metadata: Metadata = {
  title: "فاحص صحة بوتات تليجرام | سوق تولز",
  description: "تحقق مجاناً وفوراً هل بوت تليجرام لا يزال فعّالاً وهل الويبهوك الخاص به يعمل بلا أخطاء.",
};

export default function BotHealthCheckPage() {
  return <HealthCheckForm />;
}
