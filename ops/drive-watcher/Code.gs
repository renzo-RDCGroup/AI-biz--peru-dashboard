/**
 * Peru Ops — Drive watcher (hardened).
 *
 * Posts new/updated files under one Drive folder tree to a Slack channel
 * (#peru-drive), in the same format the original watcher used:
 *
 *   2 new files in Peru Operations
 *   *<link|file name>*
 *   `🇵🇪Peru Operations / Sub folder / ...`
 *   *Added by* <mailto:someone@example.com|someone@example.com>
 *   Image · 1.8 MB · 28 Sep 2026, 15:07
 *
 * WHY THIS VERSION EXISTS. "Exception: Service error: Drive" is a transient
 * Google-side failure. The original watcher emailed on every single one, even
 * though the next run succeeded. This version:
 *   - retries transient Drive / Slack errors with exponential backoff,
 *   - only advances its checkpoint after a file has been posted, so a failed
 *     run never loses a file (the next run picks it up),
 *   - takes a script lock so two overlapping runs can't collide,
 *   - never throws out of the trigger (so Google's own failure digests stop too),
 *   - emails ONLY after ALERT_AFTER_FAILURES consecutive failed runs, once per
 *     incident, and sends one "recovered" email when it works again.
 *
 * SETUP (one time) — see README.md in this folder:
 *   1. Services (+) → add "Drive API" (v3), identifier "Drive".
 *   2. Project Settings → Script Properties:
 *        SLACK_WEBHOOK_URL   required — the #peru-drive incoming webhook
 *        ROOT_FOLDER_ID      required — id of the "🇵🇪Peru Operations" folder
 *        ALERT_EMAIL         optional — defaults to the script owner
 *        ALERT_AFTER_FAILURES optional — defaults to 3 (≈45 min at 15-min cadence)
 *   3. Run setup() once and approve the permissions.
 */

var WATCHER = {
  HANDLER: 'runDriveWatcher',
  INTERVAL_MINUTES: 15,
  LABEL: 'Peru Operations',
  MAX_FILES_PER_MESSAGE: 20,
  // Re-read this much before the checkpoint, to absorb Drive's indexing lag.
  OVERLAP_MS: 5 * 60 * 1000,
  // Apps Script kills a run at 6 min; stop early and let the next run resume.
  RUNTIME_BUDGET_MS: 4.5 * 60 * 1000,
  RETRY_DELAYS_MS: [2000, 4000, 8000, 16000],
  SUBJECT_PREFIX: '[Peru Ops] Drive watcher',
  TIME_ZONE: 'America/Lima',
};

var PROP = {
  CHECKPOINT: 'DW_CHECKPOINT_ISO',
  SEEN: 'DW_SEEN_JSON',
  FAILS: 'DW_CONSECUTIVE_FAILURES',
  FIRST_FAIL: 'DW_FIRST_FAILURE_ISO',
  LAST_ERROR: 'DW_LAST_ERROR',
  ALERTED: 'DW_ALERTED',
};

var TRANSIENT_ERROR =
  /service error|server error|internal error|backend error|rate limit|user rate|too many|timed out|timeout|unavailable|bad gateway|try again|\b(429|500|502|503|504)\b/i;

/** One-time install: validates config, seeds the checkpoint, (re)creates the trigger. */
function setup() {
  var cfg = readConfig_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP.CHECKPOINT)) {
    // Start from "now" so the first run doesn't replay the whole folder into Slack.
    props.setProperty(PROP.CHECKPOINT, new Date().toISOString());
  }
  // Remove every trigger in this project — including the old watcher's, whose
  // handler name no longer exists after the code is replaced.
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(WATCHER.HANDLER).timeBased().everyMinutes(WATCHER.INTERVAL_MINUTES).create();
  var root = withRetry_(function () {
    return Drive.Files.get(cfg.rootFolderId, { fields: 'id,name', supportsAllDrives: true });
  }, 'read root folder');
  Logger.log('Drive watcher installed: every %s min on "%s"; checkpoint %s',
    WATCHER.INTERVAL_MINUTES, root.name, props.getProperty(PROP.CHECKPOINT));
}

/** Trigger handler. Never throws: failures are counted and alerted on, not raised. */
function runDriveWatcher() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('Previous run still in progress; skipping this tick.');
    return;
  }
  try {
    var result = watchOnce_();
    recordSuccess_();
    Logger.log('Posted %s file(s); checkpoint now %s%s', result.posted, result.checkpoint,
      result.truncated ? ' (time budget reached, resuming next run)' : '');
  } catch (err) {
    recordFailure_(err);
  } finally {
    lock.releaseLock();
  }
}

function watchOnce_() {
  var started = Date.now();
  var cfg = readConfig_();
  var props = PropertiesService.getScriptProperties();
  var checkpoint = props.getProperty(PROP.CHECKPOINT) || new Date(started).toISOString();
  var seen = parseJson_(props.getProperty(PROP.SEEN), {});
  var since = new Date(Date.parse(checkpoint) - WATCHER.OVERLAP_MS).toISOString();

  var changed = listChangedFiles_(since);
  var pathCache = {};
  var pending = [];
  for (var i = 0; i < changed.length; i++) {
    var f = changed[i];
    if (seen[f.id] === f.modifiedTime) continue; // already posted this exact revision
    var path = folderPath_(f.parents && f.parents[0], cfg.rootFolderId, pathCache);
    if (!path) continue; // not under the watched folder
    pending.push({ file: f, path: path });
  }

  var posted = 0;
  var truncated = false;
  var newCheckpoint = checkpoint;
  for (var start = 0; start < pending.length; start += WATCHER.MAX_FILES_PER_MESSAGE) {
    if (Date.now() - started > WATCHER.RUNTIME_BUDGET_MS) { truncated = true; break; }
    var batch = pending.slice(start, start + WATCHER.MAX_FILES_PER_MESSAGE);
    postToSlack_(cfg.webhookUrl, formatMessage_(batch, checkpoint));
    // Advance only past what was actually delivered.
    batch.forEach(function (item) {
      seen[item.file.id] = item.file.modifiedTime;
      if (item.file.modifiedTime > newCheckpoint) newCheckpoint = item.file.modifiedTime;
    });
    posted += batch.length;
  }
  if (!truncated && changed.length && changed[changed.length - 1].modifiedTime > newCheckpoint) {
    // Everything listed was either posted or deliberately skipped (outside the tree).
    newCheckpoint = changed[changed.length - 1].modifiedTime;
  }

  props.setProperty(PROP.CHECKPOINT, newCheckpoint);
  props.setProperty(PROP.SEEN, JSON.stringify(pruneSeen_(seen, newCheckpoint)));
  return { posted: posted, checkpoint: newCheckpoint, truncated: truncated };
}

/** Every non-folder, non-trashed file modified after `sinceIso`, oldest first. */
function listChangedFiles_(sinceIso) {
  var files = [];
  var pageToken = null;
  do {
    var page = withRetry_(function () {
      return Drive.Files.list({
        q: "modifiedTime > '" + sinceIso + "' and trashed = false and " +
           "mimeType != 'application/vnd.google-apps.folder'",
        orderBy: 'modifiedTime',
        pageSize: 200,
        pageToken: pageToken,
        corpora: 'user', // My Drive + shared with me
        supportsAllDrives: true,
        fields: 'nextPageToken, files(id, name, mimeType, size, quotaBytesUsed, createdTime, ' +
                'modifiedTime, webViewLink, parents, lastModifyingUser(emailAddress, displayName))',
      });
    }, 'list changed files');
    (page.files || []).forEach(function (f) { files.push(f); });
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * Folder names from the watched root down to `folderId`, or null when the folder
 * is not inside the root. Memoised per run; a folder can have one parent in Drive.
 */
function folderPath_(folderId, rootId, cache) {
  var chain = [];
  var id = folderId;
  for (var depth = 0; id && depth < 30; depth++) {
    if (cache.hasOwnProperty(id)) {
      var hit = cache[id];
      return finishPath_(hit === null ? null : hit.concat(chain.map(function (c) { return c.name; })), chain, cache);
    }
    var folder;
    try {
      folder = withRetry_(function () {
        return Drive.Files.get(id, { fields: 'id, name, parents', supportsAllDrives: true });
      }, 'read folder ' + id);
    } catch (err) {
      // A parent we can't see (file shared with us directly) is simply outside the
      // tree. Only a transient failure should fail the run.
      if (TRANSIENT_ERROR.test(String(err && err.message || err))) throw err;
      return finishPath_(null, chain, cache);
    }
    chain.unshift({ id: folder.id, name: folder.name });
    if (folder.id === rootId) {
      return finishPath_(chain.map(function (c) { return c.name; }), chain, cache);
    }
    id = folder.parents && folder.parents[0];
  }
  return finishPath_(null, chain, cache);
}

function finishPath_(names, chain, cache) {
  // Cache every folder we walked through, so siblings resolve without API calls.
  for (var i = 0; i < chain.length; i++) {
    cache[chain[i].id] = names === null ? null : names.slice(0, names.length - (chain.length - 1 - i));
  }
  return names;
}

function formatMessage_(batch, checkpoint) {
  var n = batch.length;
  var lines = [n === 1 ? 'New file in ' + WATCHER.LABEL : n + ' new files in ' + WATCHER.LABEL];
  batch.forEach(function (item) {
    var f = item.file;
    var who = (f.lastModifyingUser && (f.lastModifyingUser.emailAddress || f.lastModifyingUser.displayName)) || 'unknown';
    var verb = f.createdTime && f.createdTime > checkpoint ? 'Added by' : 'Updated by';
    var whoText = who.indexOf('@') > 0 ? '<mailto:' + who + '|' + who + '>' : who;
    lines.push('*<' + f.webViewLink + '|' + slackEscape_(f.name) + '>*');
    lines.push('`' + item.path.join(' / ') + '`');
    lines.push('*' + verb + '* ' + whoText);
    lines.push([kindOf_(f.mimeType), humanSize_(Number(f.size || f.quotaBytesUsed || 0)),
      Utilities.formatDate(new Date(f.modifiedTime), WATCHER.TIME_ZONE, 'd MMM yyyy, HH:mm')].join(' · '));
  });
  return lines.join('\n');
}

function postToSlack_(webhookUrl, text) {
  withRetry_(function () {
    var res = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code !== 200) throw new Error('Slack webhook HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
  }, 'post to Slack');
}

/** Runs fn, retrying only errors that look transient. */
function withRetry_(fn, what) {
  for (var attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      var msg = String(err && err.message || err);
      if (attempt >= WATCHER.RETRY_DELAYS_MS.length || !TRANSIENT_ERROR.test(msg)) {
        throw new Error(what + ' failed after ' + (attempt + 1) + ' attempt(s): ' + msg);
      }
      var delay = WATCHER.RETRY_DELAYS_MS[attempt];
      Utilities.sleep(delay + Math.floor(Math.random() * 1000));
    }
  }
}

function recordFailure_(err) {
  var cfg = readConfigLenient_();
  var props = PropertiesService.getScriptProperties();
  var fails = Number(props.getProperty(PROP.FAILS) || 0) + 1;
  var nowIso = new Date().toISOString();
  var msg = String(err && err.message || err);
  props.setProperty(PROP.FAILS, String(fails));
  props.setProperty(PROP.LAST_ERROR, msg.slice(0, 500));
  if (fails === 1) props.setProperty(PROP.FIRST_FAIL, nowIso);
  Logger.log('Drive watcher run failed (%s in a row): %s', fails, msg);

  if (fails >= cfg.alertAfter && !props.getProperty(PROP.ALERTED)) {
    MailApp.sendEmail(cfg.alertEmail, WATCHER.SUBJECT_PREFIX + ' error',
      'The Drive watcher has failed ' + fails + ' runs in a row (since ' +
      props.getProperty(PROP.FIRST_FAIL) + ').\n\nLast error: ' + msg + '\n\n' +
      'No files are lost: the checkpoint only moves after a file is posted to Slack, ' +
      'so everything will be posted once Drive recovers. You will get one more email ' +
      'when it does.');
    props.setProperty(PROP.ALERTED, nowIso);
  }
}

function recordSuccess_() {
  var props = PropertiesService.getScriptProperties();
  var fails = Number(props.getProperty(PROP.FAILS) || 0);
  if (props.getProperty(PROP.ALERTED)) {
    var cfg = readConfigLenient_();
    MailApp.sendEmail(cfg.alertEmail, WATCHER.SUBJECT_PREFIX + ' recovered',
      'The Drive watcher is working again after ' + fails + ' failed run(s) since ' +
      props.getProperty(PROP.FIRST_FAIL) + '. Any files from that window have now been posted.');
  }
  if (fails) {
    [PROP.FAILS, PROP.FIRST_FAIL, PROP.LAST_ERROR, PROP.ALERTED].forEach(function (k) {
      props.deleteProperty(k);
    });
  }
}

function readConfig_() {
  var p = PropertiesService.getScriptProperties();
  var webhookUrl = (p.getProperty('SLACK_WEBHOOK_URL') || '').trim();
  var rootFolderId = (p.getProperty('ROOT_FOLDER_ID') || '').trim();
  if (!webhookUrl) throw new Error('Script property SLACK_WEBHOOK_URL is not set');
  if (!rootFolderId) throw new Error('Script property ROOT_FOLDER_ID is not set');
  var lenient = readConfigLenient_();
  return { webhookUrl: webhookUrl, rootFolderId: rootFolderId, alertEmail: lenient.alertEmail, alertAfter: lenient.alertAfter };
}

/** The parts of config needed to raise an alert, even when the rest is broken. */
function readConfigLenient_() {
  var p = PropertiesService.getScriptProperties();
  var alertAfter = parseInt(p.getProperty('ALERT_AFTER_FAILURES') || '3', 10);
  return {
    alertEmail: (p.getProperty('ALERT_EMAIL') || '').trim() || Session.getEffectiveUser().getEmail(),
    alertAfter: alertAfter > 0 ? alertAfter : 3,
  };
}

function pruneSeen_(seen, checkpoint) {
  // Only revisions inside the overlap window can be re-listed; drop the rest.
  var floor = new Date(Date.parse(checkpoint) - 2 * WATCHER.OVERLAP_MS).toISOString();
  var out = {};
  Object.keys(seen).forEach(function (id) { if (seen[id] >= floor) out[id] = seen[id]; });
  return out;
}

function kindOf_(mimeType) {
  var m = mimeType || '';
  var google = {
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.form': 'Google Form',
    'application/vnd.google-apps.drawing': 'Google Drawing',
  };
  if (google[m]) return google[m];
  if (m === 'application/pdf') return 'PDF';
  if (m.indexOf('image/') === 0) return 'Image';
  if (m.indexOf('video/') === 0) return 'Video';
  if (m.indexOf('audio/') === 0) return 'Audio';
  if (/spreadsheet|excel|csv/.test(m)) return 'Spreadsheet';
  if (/presentation|powerpoint/.test(m)) return 'Presentation';
  if (/word|opendocument\.text|msword/.test(m)) return 'Document';
  if (/zip|compressed|x-rar|x-7z/.test(m)) return 'Archive';
  return 'File';
}

function humanSize_(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function slackEscape_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '¦');
}

function parseJson_(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; }
}
