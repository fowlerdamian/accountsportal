# Reship delivery follow-up

**Standing rule:** when a Support Hub case (`public.cases`) has a reship /
replacement tracking number, the staff member who made the case should follow up
to confirm the replacement parcel actually reached the customer.

`reship-followup.mjs` enforces that rule. It finds qualifying cases that don't yet
have a follow-up task and creates a `staff_tasks` row **assigned to the case
owner**, titled `Confirm reship delivered — <case#> — <customer>`, with the order
number, reship tracking number, carrier, ship date and a carrier tracking link in
the description.

## What "qualifying" means

A case qualifies when:

- `replacement_tracking_number` is present (non-empty), **and**
- `reship_followup_at` is null (no task created yet), **and**
- the reship shipped within the last `--max-age-days` days (default 30), unless
  `--backfill` is passed.

## Idempotency

Two columns on `cases` make re-runs cheap and safe (added by migration
`add_reship_followup_tracking_to_cases`):

- `reship_followup_at timestamptz` — set when the case has been handled. The job
  only ever looks at rows where this is null.
- `reship_followup_task_id uuid` — links to the created `staff_tasks` row
  (`on delete set null`).

The 8 reships that existed before this job was installed were stamped
`reship_followup_at = now()` (no task) so they are treated as already handled —
their parcels shipped in Mar/Apr and are long resolved. To create tasks for them
anyway, null the column for those cases and run with `--backfill`.

## Owner mapping (important)

`cases.user_id` references `team_members(id)`, but `staff_tasks.assigned_to` /
`created_by` reference `auth.users(id)`. The script resolves the owner by email:
`team_members.email` → `profiles.email` → `profiles.id` (= the auth user id).
If a case owner can't be resolved to an auth user, that case is **skipped** (logged
`[skip]`) and left unstamped so a later run can retry.

## Run manually

```powershell
cd C:\Users\Damian\accounts-portal
$env:SUPABASE_SERVICE_ROLE_KEY = '<service role key>'
node tools\reship-followup.mjs --dry-run        # preview, writes nothing
node tools\reship-followup.mjs                   # live, last 30 days
node tools\reship-followup.mjs --backfill        # ignore the age window
node tools\reship-followup.mjs --max-age-days=7  # custom window
```

Output is one line per case: `[ok]`, `[skip]`, `[fail]`, plus a summary.

## Scheduled task

Registered as **`AGA-Reship-Followup`** — runs every 6 hours (from 08:00), as user
`Damian`, interactive/limited (same context as `AGA-SLDPRT-Thumbnails`).

The wrapper `reship-followup-scheduled.ps1` decrypts the Supabase service-role key
from `.reship-followup-key.bin`, falling back to the existing `.sldprt-key.bin`
(DPAPI, user-scoped — only decryptable by `Damian` on this machine), sets it as an
env var, runs the script, then clears the env var.

To use a dedicated key instead of the shared one:

```powershell
Read-Host -AsSecureString 'Paste service role key' |
  ConvertFrom-SecureString |
  Set-Content C:\Users\Damian\accounts-portal\tools\.reship-followup-key.bin
```

Manage the task:

```powershell
Start-ScheduledTask  -TaskName AGA-Reship-Followup   # run now
Get-ScheduledTaskInfo -TaskName AGA-Reship-Followup  # last result / next run
Disable-ScheduledTask -TaskName AGA-Reship-Followup  # pause
```

## Tuning

Edit the constants near the top of `reship-followup.mjs`:

- `TASK_URGENCY` / `TASK_IMPORTANCE` (1–5) — currently 3 / 3.
- `DELIVERY_BUFFER_DAYS` — due date = ship date + this many days (currently 5).
- `CARRIER_LABELS` / `CARRIER_TRACK_URL` — pretty names and tracking links per carrier.
