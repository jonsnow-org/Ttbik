-- Birthday reminders of the Athar bot: month, day and (optional) year a person chose, and the last reminder sent (so none is sent twice).
alter table athar_bot_user add column if not exists birth_month smallint;
alter table athar_bot_user add column if not exists birth_day smallint;
alter table athar_bot_user add column if not exists birth_year smallint;
alter table athar_bot_user add column if not exists birthday_notified text;
