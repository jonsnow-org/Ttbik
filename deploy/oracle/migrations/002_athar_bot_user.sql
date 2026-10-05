-- Language chosen by each person in the Athar Telegram bot (English until they choose another).
create table if not exists athar_bot_user (
  bot_id text not null,
  tg_user_id text not null,
  lang text not null default 'en',
  updated_at timestamptz not null default now(),
  primary key (bot_id, tg_user_id)
);
