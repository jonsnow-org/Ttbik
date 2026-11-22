"""Sham 2 self-evolution (T-LDM): learning from every user's verified work, from its own failures and from the public web, without forgetting.

Stdlib-only modules (the serving path can import them without torch):
  experience  -- anonymised execution records, PII scrubbing, dedup, per-user rate limits, poisoning defences, admission to TRAINING
  lessons     -- failures as retrievable lessons + verified successes as retrievable recipes, used at inference
  web_learning-- the web-learning stage: failure-driven queries, free public sources, extraction, licence/decontamination/injection filters
Torch modules (training side only):
  curriculum  -- variants of failed tasks, best-of-n sampling verified by real execution -> verified pairs
  adapters    -- per-task-cluster LoRA adapters inside ONE model, router by task type, gate, merge/prune, versioning and rollback
  engine      -- one evolution round = serve -> verify -> lessons -> curriculum -> admit -> train candidate adapters with replay -> gate -> accept/rollback

Scope (owner, 2026-11-18): every filter here applies ONLY to data that enters TRAINING. Nothing in this package restricts what the model may do for a user at
work time (search, browse, log in to the user's own accounts, execute); those limits live in the serving path (user's own workspace, the user approves their own
sensitive commands, the owner's deny list for everyone)."""
