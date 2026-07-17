# Media migration runbook

Production operator checklist for the unified media backend migration
(plan: `docs/superpowers/plans/2026-07-14-unified-media-backend-and-migration.md`,
spec: `docs/superpowers/specs/2026-07-13-article-media-journal-management-design.md`).

The migration is **non-destructive** to file bytes — `plan` never moves or
deletes anything, and `apply` only creates rows in the two new
tables (`media_assets`, `media_usages`). The only files that ever get
deleted are the ones a human runs through `purge` after a 30-day
retention window.

## 1. Backup

Before doing anything else, snapshot both the database and the uploads
tree:

```bash
BACKUP_DIR=/absolute/path/to/backup/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"

sqlite3 /absolute/path/research.db ".backup '$BACKUP_DIR/research.db'"
sqlite3 "$BACKUP_DIR/research.db" "PRAGMA integrity_check;"

tar -C /absolute/path -czf "$BACKUP_DIR/uploads.tar.gz" uploads
shasum -a 256 "$BACKUP_DIR/research.db" "$BACKUP_DIR/uploads.tar.gz" \
    > "$BACKUP_DIR/manifest.sha256"

tar -tzf "$BACKUP_DIR/uploads.tar.gz" >/dev/null   # smoke-test the tarball
```

Keep the backup directory on a different volume than the running server.

## 2. Maintenance mode

`apply` refuses to run unless the operator opts in via an env flag.
Set it for the duration of the apply window only:

```bash
export MEDIA_MIGRATION_MAINTENANCE=1
# stop the FastAPI workers (or take the LB pool out of rotation)
```

## 3. Doctor

Inventory DB + uploads with the same code the script uses internally:

```bash
cd /absolute/path/backend
python -m app.scripts.migrate_media doctor --report "$BACKUP_DIR/doctor.txt"
```

A non-zero exit means: read the `issues` list. The four common causes:

* `db_read_failed` — DB file is locked or unreadable; check file mode.
* Empty `regular_file_count` — uploads root wrong; compare the
  printed absolute path to the live deployment's mount.
* Non-zero byte total but zero files — the uploads root points inside a
  bind mount that broke.
* `PRAGMA integrity_check` was NOT run by this command; do that
  manually against the backup (step 1) since the live DB is still open.

## 4. Plan

Run plan into a fresh, OUTSIDE-the-source-tree directory:

```bash
PLAN_DIR="$BACKUP_DIR/plan"
mkdir -p "$PLAN_DIR"
python -m app.scripts.migrate_media plan --report-dir "$PLAN_DIR"
```

The script writes three artifacts and prints one hash:

```
plan.json          canonical JSON of the plan — the only thing apply consumes
report.md          human-readable summary
manifest.sha256    hash of every file under uploads/ sorted by relpath
plan_sha256=<HEX>  hash of plan.json (canonical, no trailing newline)
```

### What to review before apply

* Every rel-path under `uploads/` appears in **exactly one** of
  `assets_to_create`, `skipped`, or `error` lists in plan.json.
* `unmapped_article_images` is short (zero in a clean install; should
  match the dev DB's "Uploaded before today" rows that lack a disk file).
* `usage_to_create` references match the live article content. Open one
  of the heaviest articles in the admin editor and confirm the in-body
  images count to the plan's `usages_to_create` length for that owner.
* `article_id=19` should appear with exactly **4** `content` usages.

If anything is off, stop and debug — `apply` is irreversible w.r.t. the
two new tables (you'd have to drop them by hand and re-run).

## 5. Apply

```bash
python -m app.scripts.migrate_media apply \
    --plan "$PLAN_DIR/plan.json" \
    --confirm-sha256 "$(cat <<<"$PLAN_SHA")"   # paste the plan_sha256 value
    --audit "$PLAN_DIR/apply-audit.jsonl"
```

`apply` writes an append-only JSONL audit log next to the plan. If
anything goes wrong mid-apply, the file contains one row per asset with
its outcome (`deleted` / `missing_file` / `skipped_in_use` / etc.).

Re-running `apply` on the same plan (or a re-`plan`'d version with the
same hash) is a no-op: rows are upserted by exact `storage_path` and
usages upserted by the unique `(asset_id, owner_type, owner_id, field)`
key.

## 6. Article 19 repair

The four-image repair runs **only** as part of an `apply` whose plan
identifies article id 19 with four exact placeholder pairs and whose
on-disk file set includes every `source-images/19-hongan-medical/imageN.png`.
All validation runs before the backup is written, so a failed
validation never leaves a partial artifact behind.

To re-run it: re-issue `plan` (the source DB only changed if a new file
landed under `uploads/source-images/19-hongan-medical/`), confirm the
SHA-256, then `apply` — the apply step transforms article 19 in the same
`BEGIN IMMEDIATE` transaction that upserts assets/usages.

## 7. Rollback

The two new tables are the only artifact left behind by the migration.
If something is wrong:

1. Unset `MEDIA_MIGRATION_MAINTENANCE`.
2. Restart the FastAPI workers (the `media_assets` / `media_usages`
   tables simply won't be queried by any code path that pre-dates this
   migration; the legacy `article_images` rows continue to work).
3. Use the backups from step 1 to restore any upload bytes that were
   deleted via `purge` (purge only removes bytes that have been in
   trash for ≥30 days, so this rarely fires).
4. Compare the backup manifest SHA-256 to a fresh
   `find uploads -type f -exec shasum -a 256 {} \;` to confirm nothing
   was added or removed silently.

## 8. Manual purge (separate workflow)

`purge` is intentionally NOT part of `migrate_media`. The
`app.scripts.purge_media plan` → `apply` flow is the ONLY way bytes get
removed; it requires an explicit retention cutoff and a separate hash
confirmation, so an operator mistake on the wrong tab cannot cause data
loss.

```bash
# default retention is 30 days; override with --retention-days N
python -m app.scripts.purge_media plan \
    --now "$TODAY_ISO" \
    --output "$PLAN_DIR/purge-plan.json"

# Inspect. Then:
python -m app.scripts.purge_media apply \
    --plan "$PLAN_DIR/purge-plan.json" \
    --confirm-sha256 "$(shasum -a 256 "$PLAN_DIR/purge-plan.json" | awk '{print $1}')" \
    --audit  "$PLAN_DIR/purge-audit.jsonl"
```

Post-apply: the audit file lists each asset_id that was purged. Bytes
that remain on disk after a `missing_file` row are orphans — re-run
`plan` to see them in `skipped`/`error` instead of in `eligible`.
