"use client";

import { useMemo, useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

const CPM_PRESETS = [
  { label: "1$", value: "1" },
  { label: "2.5$", value: "2.5" },
  { label: "4$", value: "4" },
];

const FILL_PRESETS = [
  { label: "25%", value: "25" },
  { label: "40%", value: "40" },
  { label: "70%", value: "70" },
  { label: "100%", value: "100" },
];

const POSTS_PRESETS = [
  { label: "8/شهر", value: "8" },
  { label: "12/شهر", value: "12" },
  { label: "20/شهر", value: "20" },
  { label: "30/شهر", value: "30" },
];

const SUB_PRESETS = [
  { label: "1 ألف", value: "1000" },
  { label: "5 آلاف", value: "5000" },
  { label: "10 آلاف", value: "10000" },
  { label: "25 ألف", value: "25000" },
  { label: "50 ألف", value: "50000" },
  { label: "100 ألف", value: "100000" },
  { label: "250 ألف", value: "250000" },
  { label: "500 ألف", value: "500000" },
  { label: "مليون", value: "1000000" },
  { label: "مليونان", value: "2000000" },
];
