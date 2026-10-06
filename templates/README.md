# templates/ — legacy samples (not a paid code catalog)

> **Product policy (see `docs/AGENT_BUS.md`):** Sham does **not** sell source code, ZIP packs, or “buy this file” products. Locked-code catalog items were permanently removed (`migration_remove_locked_code_products.sql` / `migration_hard_delete_locked_code_products.sql`). Do not re-add delivery links that treat these folders as paid downloadables.

## What this folder is

| Role | Meaning |
|---|---|
| **Hosted bots (real product)** | Customers activate a bot that **runs on our servers** via `/bots` + their BotFather token. Template logic stays on the platform — it is **not** handed over as a downloadable product. |
| **Free FAQ / auto-reply samples** | Some simple bots under here deliberately ship readable source as **free examples / education**, not as a paid SKU. |
| **Studio / browser tools** | In-browser utilities (e.g. invoice generator) may live nearby as demos; monetization (if any) is access/unlock of a **hosted or browser tool**, not selling a code archive. |

## Folders (reference only)

| Folder | Notes |
|---|---|
| `auto-reply-bot` | Free-style sample Telegram keyword bot |
| `faq-bot` | Free-style FAQ sample |
| `order-manager-bot` | Legacy sample — **not** a sellable locked-code product |
| `landing-page-template` | Legacy sample page |
| `automation-recipes` | Free Apps Script recipe notes |
| `invoice-generator` | Browser demo / tool sample |
| `whatsapp-catalog` | Legacy sample |
| `ad-slot-bot` | Legacy sample — ads/slots product path is hosted, not ZIP delivery |

If a service page or seed SQL still points at `templates/` as “delivery after payment”, treat that as **outdated**; align copy with hosted bots + free tools + Done-for-you services reviewed in `/admin`.
