// Runs in the browser (admin only). Turns the code-drawn scene of a special date into its final waxed-gold picture:
// scene -> canvas -> gold treatment -> (Syrian dates: the flag drawn on top in its true colours) -> JPEG within the storage budget.
import { specialScene } from "./specialArt";
import { waxPixels } from "./wax";

const loadSvg = (svg: string) => new Promise<HTMLImageElement>((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => rej(new Error("scene did not load"));
  i.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
});

export async function renderSpecialGold(index: number, budget = 58_000): Promise<string | null> {
  const a = specialScene(index);
  if (!a) return null;
  const S = 640;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(await loadSvg(a.scene), 0, 0, S, S);
  const id = x.getImageData(0, 0, S, S);
  id.data.set(waxPixels(id.data, S, S, "gold"));
  x.putImageData(id, 0, 0);
  if (a.overlay) x.drawImage(await loadSvg(a.overlay), 0, 0, S, S);
  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
    const out = c.toDataURL("image/jpeg", q);
    if (Math.floor((out.length - out.indexOf(",") - 1) * 0.75) <= budget) return out;
  }
  return null;
}
