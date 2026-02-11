# PartyPass Backup Routine

## Weekly backup (Windows PowerShell)

1. Set `DATABASE_URL` in your shell.
2. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\export-db.ps1
```

This creates `backups/partypass-YYYYMMDD-HHMMSS.sql`.

## Automate weekly

Use Windows Task Scheduler:

1. Action: start program `powershell.exe`
2. Arguments:

```text
-ExecutionPolicy Bypass -File C:\path\to\DJ_Party_Pass\backend\scripts\export-db.ps1
```

3. Trigger: Weekly
4. Ensure environment includes `DATABASE_URL`.

## Restore

Use psql with a target database:

```powershell
psql "postgresql://user:password@host:5432/dbname" -f .\backups\partypass-YYYYMMDD-HHMMSS.sql
```
