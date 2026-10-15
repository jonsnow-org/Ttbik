import { Composition } from "remotion";
import { Promo, PromoProps, FPS, CTA_SEC } from "./Promo";

const defaults: PromoProps = { title: "مولّد رمز QR", hook: "رمز QR بثانية… ببلاش!", words: [], voiceSec: 17 };

export const Root = () => (
  <Composition
    id="Promo"
    component={Promo}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={600}
    defaultProps={defaults}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.round(Math.min(30, Math.max(20, props.voiceSec + 0.4 + CTA_SEC)) * FPS),
    })}
  />
);
