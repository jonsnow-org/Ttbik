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
  { label: "5 ملايين", value: "5000000" },
  { label: "10 ملايين", value: "10000000" },
  { label: "20 مليون", value: "20000000" },
  { label: "50 مليون", value: "50000000" },
  { label: "100 مليون", value: "100000000" },
  { label: "200 مليون", value: "200000000" },
  { label: "500 مليون", value: "500000000" },
  { label: "مليار", value: "1000000000" },
  { label: "ملياران", value: "2000000000" },
];

const VIEW_PRESETS = [
  { label: "500", value: "500" },
  { label: "1 ألف", value: "1000" },
  { label: "2 ألف", value: "2000" },
  { label: "5 آلاف", value: "5000" },
];

const TARGET_PRESETS = [
  { label: "50$", value: "50" },
  { label: "100$", value: "100" },
  { label: "250$", value: "250" },
  { label: "500$", value: "500" },
  { label: "1000$", value: "1000" },
];

const inputCls =
  "w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

function chipCls(active: boolean) {
  return `rounded-full px-3 py-1 text-xs font-bold ${
    active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
  }`;
}
