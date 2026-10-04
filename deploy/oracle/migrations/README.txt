Each *.sql file here is applied to the live database once (by name and checksum) by agent/migrate.sh, from the update agent.
Files must be safe to repeat (create ... if not exists, add column if not exists). Add a new file with the next number; never edit an applied one.
