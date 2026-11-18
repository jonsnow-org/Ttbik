# Owner identity and recovery

Platform owner permissions are a **list** of Telegram user ids and app account ids, not a single hard-coded id. Include a backup account.

## How to set or change owner ids

1. In the GitHub repo: **Settings → Secrets and variables → Actions** (and any environment that deploys the Oracle host). Set `OWNER_IDS` to a comma-separated list of Telegram user ids and app account ids. You can also set `OWNER_TELEGRAM_IDS` and `OWNER_APP_IDS`. Existing `SUPER_ADMIN_TELEGRAM_ID` and `TELEGRAM_ADMIN_CHAT_ID` are still included.
2. Put the same names on the Oracle host env (the live site reads them there). Do not commit values to the repo.
3. Redeploy or restart so the process loads the new list.
4. Accounts unlocked with the passphrase are stored in `coder_flags` under the key `owner_ids` (ids only, never the passphrase). To revoke a recovered account, remove its id from that stored list and from the secrets above.

## Owner passphrase (recovery)

If an owner account is lost, the owner writes the passphrase as a **whole private message** to the bot (from any account). On a match, that account is added to the stored owner list and has full owner permissions.

- Preferred secret name: **`SHAM_OWNER_PASSPHRASE_HASH`**
- Value: lowercase hex SHA-256 of the exact UTF-8 passphrase (trimmed). Example of how to compute it locally, using your own phrase: `printf '%s' 'your-passphrase' | sha256sum`
- Optional alternative: `SHAM_OWNER_PASSPHRASE` (plaintext, hashed at process load). Prefer the hash secret so the phrase itself is not in the environment.
- Leave both unset in the repo. The owner sets the secret in GitHub (and on the Oracle host) himself.
- Compare is constant-time on the hashes of the whole message. The Telegram message is deleted. After several failed passphrase-like attempts, that chat is locked for a period. Ordinary conversation is not counted as a failure and is not deleted.
- A matching or attempted passphrase is excluded from experience logs, training data, chat history, and error reports. The phrase is never logged or echoed.

This is not a slash command. Type only the passphrase as the entire message.
