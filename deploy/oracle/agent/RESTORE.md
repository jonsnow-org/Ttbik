# Rebuild everything from this one file (Render, Vercel, Oracle and GitHub may all be gone)

1. Unpack: `tar xzf ttbik-code-latest.tar.gz && cd ttbik`
2. Source code, every branch and all history: `git clone repo-latest.bundle ttbik-src && cd ttbik-src && git checkout main`
   Put it on any new Git host (or just keep it local).
3. Database (Postgres, e.g. a free Supabase/Neon project): `pg_restore --no-owner -d "<new DATABASE_URL>" ../database.dump`
4. Site + bots: deploy `ttbik-src` on any Next.js host (Vercel/Render/Cloudflare). Set the same environment variables
   (their NAMES are in ENV-VARS.md; their VALUES are not in this file: keep them in your password manager).
   Then re-set each Telegram bot webhook (admin panel: activate bots) to the new domain.
5. Athar server (Oracle or any Docker host): follow `deploy/oracle/` in the source; restore `athar-data.tgz` into `/var/lib/ttbik/athar`.
6. Athar front door: deploy `cloudflare/athar-front` as a Cloudflare Worker (it only needs the list of origins in the file).
7. The tokens and their pictures live on the TON blockchain and Arweave: they do not depend on any of the above.
