"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// O4 co-build pass 6 (Grok): ribbon layout + real SVG XML escape.
const FONTS = [
  { id: "cairo", family: "Cairo", weight: "900", label: "Cairo — عصري هندسي" },
  { id: "tajawal", family: "Tajawal", weight: "800", label: "Tajawal — نظيف حديث" },
  { id: "aref", family: "Aref Ruqaa", weight: "700", label: "Aref Ruqaa — خط تقليدي" },
  { id: "lalezar", family: "Lalezar", weight: "400", label: "Lalezar — عريض جريء" },
  { id: "amiri", family: "Amiri", weight: "700", label: "Amiri — نسخي كلاسيكي" },
] as const;
