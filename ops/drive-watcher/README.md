# Peru Ops — Drive watcher

Posts new and updated files in the **🇵🇪Peru Operations** Drive folder to Slack
`#peru-drive`. This is a hardened replacement for the Apps Script that emailed
`[Peru Ops] Drive watcher error — Exception: Service error: Drive`.

## Why it was emailing

`Service error: Drive` is a transient failure on Google's side. The old watcher sent
an email on every one, even though the next run 15 minutes later worked (on
2026-09-28 it failed around 10:50 and posted normally at 12:50, 13:05 and 15:20).

This version:

- retries transient Drive and Slack errors with backoff (2s, 4s, 8s, 16s);
- only moves its checkpoint after a file has been posted, so a failed run never
  drops a file;
- takes a lock so two runs can't overlap;
- never throws out of the trigger, so Google's "Summary of failures" emails stop too;
- emails **only after 3 failed runs in a row** (about 45 minutes), once per incident,
  and sends one "recovered" email when it works again.

The Slack message format is unchanged.

## Install (about 5 minutes, in the Google account that owns the old watcher)

1. Open <https://script.google.com> and open the existing watcher project.
2. **Copy the Slack webhook URL** out of the old code first. You'll need it in step 5.
3. Replace the contents of `Code.gs` with [`Code.gs`](Code.gs) from this folder.
   Delete any other `.gs` files that belonged to the old watcher.
4. **Services** (the `+` next to Services) → add **Drive API**, version **v3**,
   identifier `Drive`. If the project already has the Drive service at **v2**, remove it
   and add v3.
5. **Project Settings → Script Properties**, add:

   | Property | Value |
   |---|---|
   | `SLACK_WEBHOOK_URL` | the `#peru-drive` webhook from step 2 |
   | `ROOT_FOLDER_ID` | the id of the 🇵🇪Peru Operations folder (the last part of its Drive URL) |
   | `ALERT_EMAIL` | optional; defaults to the account running the script |
   | `ALERT_AFTER_FAILURES` | optional; defaults to `3` |

6. Select `setup` in the function dropdown and click **Run**. Approve the permissions.
   `setup` deletes the old trigger and creates one 15-minute trigger for
   `runDriveWatcher`. It starts from "now", so it won't re-post old files.
7. Optional: run `runDriveWatcher` once by hand and check **Executions** for a clean run.

Webhooks and folder ids go in Script Properties, never in this file: this repository
is public.

## Tests

```bash
node --test ops/drive-watcher/test/drive-watcher.test.mjs
```

The tests run `Code.gs` against in-memory fakes of Drive, Slack, properties, mail and
triggers. They cover: message format, dedupe across the overlap window, retrying
transient errors, the 3-failure alert and the recovery email, Slack 503 retries,
batching, `setup`, files outside the tree, and missing configuration.
