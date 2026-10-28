// ESLint 9 flat config (Next 16 removed `next lint`; `npm run lint` runs ESLint directly).
// Errors that remain fail the run. Rules below are "warn" on purpose: they come from eslint-plugin-react-hooks v7 (React-Compiler checks) and Next's link/img advice;
// fixing each one means changing component behaviour, so they are reported, not enforced, until each file is touched for another reason.
import next from "eslint-config-next";

export default [
  ...next,
  { ignores: [".next/**", "node_modules/**", "athar/**", "quarantine/**", "public/**", "coder-sandbox/**", "templates/**", "e2e/**", "media-bot/**", "scripts/**", "src/lib/vendor/**"] },
  {
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-html-link-for-pages": "warn",   // <a href> inside the Telegram Mini Apps is deliberate in places (full reload)
      "@next/next/no-img-element": "warn",
      "react/no-unescaped-entities": "off",           // plain text in Arabic / English pages
    },
  },
];
