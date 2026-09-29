// Runs Code.gs against in-memory fakes of the Apps Script services.
//   node --test ops/drive-watcher/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(here, '..', 'Code.gs'), 'utf8');

const ROOT = 'root-folder';
const T0 = '2026-09-28T17:00:00.000Z';

function makeWorld({ files = [], folders = {}, failures = {} } = {}) {
  const props = new Map([
    ['SLACK_WEBHOOK_URL', 'https://hooks.slack.test/abc'],
    ['ROOT_FOLDER_ID', ROOT],
  ]);
  const posts = [];
  const mails = [];
  const triggers = [];
  const calls = { list: 0, get: 0, fetch: 0 };
  // failures: { list: n, get: n, fetch: n, listMessage } — throw on the first n calls.
  const fail = (kind) => {
    if ((failures[kind] || 0) > 0) {
      failures[kind] -= 1;
      throw new Error(failures[`${kind}Message`] || 'Service error: Drive');
    }
  };
  const ctx = {
    Drive: {
      Files: {
        list: (opts) => {
          calls.list += 1;
          fail('list');
          const since = /modifiedTime > '([^']+)'/.exec(opts.q)[1];
          const out = files
            .filter((f) => f.modifiedTime > since)
            .sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
          return { files: out.map((f) => ({ ...f })) };
        },
        get: (id) => {
          calls.get += 1;
          fail('get');
          if (!folders[id]) throw new Error(`File not found: ${id}`);
          return { id, ...folders[id] };
        },
      },
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        calls.fetch += 1;
        if ((failures.fetch || 0) > 0) {
          failures.fetch -= 1;
          return { getResponseCode: () => 503, getContentText: () => 'service_unavailable' };
        }
        posts.push(JSON.parse(opts.payload).text);
        return { getResponseCode: () => 200, getContentText: () => 'ok' };
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: (k) => props.delete(k),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    Utilities: {
      sleep: () => {},
      formatDate: (d) => d.toISOString().slice(0, 16),
    },
    Logger: { log: () => {} },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => ({
        timeBased: () => ({ everyMinutes: (m) => ({ create: () => triggers.push({ fn, m }) }) }),
      }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  return { ctx, props, posts, mails, triggers, calls, files };
}

const tree = {
  [ROOT]: { name: '🇵🇪Peru Operations', parents: ['my-drive'] },
  leslie: { name: 'Leslie - Coordinadora', parents: [ROOT] },
  visuales: { name: '00_VISUALES', parents: ['leslie'] },
  'my-drive': { name: 'My Drive', parents: [] },
  elsewhere: { name: 'Unrelated', parents: ['my-drive'] },
};

function file(id, parent, modifiedTime, extra = {}) {
  return {
    id, name: `${id}.png`, mimeType: 'image/png', size: String(1.8 * 1024 * 1024),
    createdTime: modifiedTime, modifiedTime, webViewLink: `https://drive.test/${id}`,
    parents: [parent], lastModifyingUser: { emailAddress: 'hola@example.com' }, ...extra,
  };
}

test('posts new files under the root in the original format and skips files outside it', () => {
  const w = makeWorld({
    folders: tree,
    files: [
      file('a', 'visuales', '2026-09-28T17:05:00.000Z'),
      file('b', 'leslie', '2026-09-28T17:06:00.000Z', {
        mimeType: 'application/pdf', createdTime: '2026-09-01T00:00:00.000Z',
      }),
      file('c', 'elsewhere', '2026-09-28T17:07:00.000Z'),
    ],
  });
  w.props.set('DW_CHECKPOINT_ISO', T0);
  w.ctx.runDriveWatcher();

  assert.equal(w.posts.length, 1);
  const msg = w.posts[0];
  assert.match(msg, /^2 new files in Peru Operations\n/);
  assert.match(msg, /\*<https:\/\/drive\.test\/a\|a\.png>\*\n`🇵🇪Peru Operations \/ Leslie - Coordinadora \/ 00_VISUALES`\n\*Added by\* <mailto:hola@example\.com\|hola@example\.com>\nImage · 1\.8 MB · /);
  assert.match(msg, /\*Updated by\*.*\nPDF · /);
  assert.doesNotMatch(msg, /c\.png/);
  assert.equal(w.props.get('DW_CHECKPOINT_ISO'), '2026-09-28T17:07:00.000Z');
  assert.equal(w.mails.length, 0);
});

test('does not re-post the same revision on the next run (overlap window dedupe)', () => {
  const w = makeWorld({ folders: tree, files: [file('a', 'visuales', '2026-09-28T17:05:00.000Z')] });
  w.props.set('DW_CHECKPOINT_ISO', T0);
  w.ctx.runDriveWatcher();
  w.ctx.runDriveWatcher();
  assert.equal(w.posts.length, 1);

  // A later edit of the same file is a new revision and is posted.
  w.files[0].modifiedTime = '2026-09-28T17:20:00.000Z';
  w.ctx.runDriveWatcher();
  assert.equal(w.posts.length, 2);
  assert.match(w.posts[1], /^New file in Peru Operations\n/);
});

test('a transient "Service error: Drive" is retried inside the run and never emails', () => {
  const w = makeWorld({
    folders: tree,
    files: [file('a', 'visuales', '2026-09-28T17:05:00.000Z')],
    failures: { list: 2, get: 1 },
  });
  w.props.set('DW_CHECKPOINT_ISO', T0);
  w.ctx.runDriveWatcher();
  assert.equal(w.posts.length, 1);
  assert.equal(w.mails.length, 0);
  assert.equal(w.props.get('DW_CONSECUTIVE_FAILURES'), undefined);
});

test('a persistent outage emails once at the threshold, keeps files, then emails once on recovery', () => {
  const w = makeWorld({
    folders: tree,
    files: [file('a', 'visuales', '2026-09-28T17:05:00.000Z')],
    failures: { list: 5 * 3 }, // 3 runs × (1 try + 4 retries)
  });
  w.props.set('DW_CHECKPOINT_ISO', T0);

  w.ctx.runDriveWatcher();
  w.ctx.runDriveWatcher();
  assert.equal(w.mails.length, 0, 'no email for the first two failed runs');
  w.ctx.runDriveWatcher();
  assert.equal(w.mails.length, 1);
  assert.equal(w.mails[0].subject, '[Peru Ops] Drive watcher error');
  assert.match(w.mails[0].body, /failed 3 runs in a row/);
  assert.equal(w.props.get('DW_CHECKPOINT_ISO'), T0, 'checkpoint did not move while failing');
  assert.equal(w.posts.length, 0);

  w.ctx.runDriveWatcher(); // Drive is back
  assert.equal(w.posts.length, 1, 'the file from the outage window is still posted');
  assert.equal(w.mails.length, 2);
  assert.equal(w.mails[1].subject, '[Peru Ops] Drive watcher recovered');
  assert.equal(w.props.get('DW_CONSECUTIVE_FAILURES'), undefined);
});

test('a non-transient error is not retried and the handler never throws', () => {
  const w = makeWorld({
    folders: tree,
    files: [file('a', 'visuales', '2026-09-28T17:05:00.000Z')],
    failures: { list: 1, listMessage: 'Access denied: insufficient permissions' },
  });
  w.props.set('DW_CHECKPOINT_ISO', T0);
  assert.doesNotThrow(() => w.ctx.runDriveWatcher());
  assert.equal(w.calls.list, 1);
  assert.equal(w.props.get('DW_CONSECUTIVE_FAILURES'), '1');
  assert.match(w.props.get('DW_LAST_ERROR'), /Access denied/);
});

test('a Slack 503 is retried; the checkpoint only advances once the post lands', () => {
  const w = makeWorld({
    folders: tree,
    files: [file('a', 'visuales', '2026-09-28T17:05:00.000Z')],
    failures: { fetch: 2 },
  });
  w.props.set('DW_CHECKPOINT_ISO', T0);
  w.ctx.runDriveWatcher();
  assert.equal(w.posts.length, 1);
  assert.equal(w.calls.fetch, 3);
  assert.equal(w.props.get('DW_CHECKPOINT_ISO'), '2026-09-28T17:05:00.000Z');
});

test('large batches are split into messages of at most 20 files', () => {
  const files = Array.from({ length: 45 }, (_, i) =>
    file(`f${String(i).padStart(2, '0')}`, 'visuales', `2026-09-28T17:${String(10 + i).padStart(2, '0')}:00.000Z`));
  const w = makeWorld({ folders: tree, files });
  w.props.set('DW_CHECKPOINT_ISO', T0);
  w.ctx.runDriveWatcher();
  assert.deepEqual(w.posts.map((p) => p.split('\n')[0]), [
    '20 new files in Peru Operations', '20 new files in Peru Operations', '5 new files in Peru Operations',
  ]);
});

test('setup seeds the checkpoint and replaces every existing trigger with one 15-minute trigger', () => {
  const w = makeWorld({ folders: tree });
  w.triggers.push({ fn: 'oldWatcherFunction', m: 10 });
  w.ctx.setup();
  assert.deepEqual(w.triggers, [{ fn: 'runDriveWatcher', m: 15 }]);
  assert.ok(w.props.get('DW_CHECKPOINT_ISO'));
});

test('a file whose parent folder is not visible is skipped without failing the run', () => {
  const w = makeWorld({
    folders: tree,
    files: [
      file('shared', 'someone-elses-folder', '2026-09-28T17:04:00.000Z'),
      file('a', 'visuales', '2026-09-28T17:05:00.000Z'),
    ],
  });
  w.props.set('DW_CHECKPOINT_ISO', T0);
  w.ctx.runDriveWatcher();
  assert.equal(w.posts.length, 1);
  assert.doesNotMatch(w.posts[0], /shared\.png/);
  assert.equal(w.props.get('DW_CONSECUTIVE_FAILURES'), undefined);
});

test('a file edited during a Drive indexing lag is still caught by the overlap window', () => {
  const w = makeWorld({ folders: tree, files: [file('a', 'visuales', '2026-09-28T17:05:00.000Z')] });
  w.props.set('DW_CHECKPOINT_ISO', T0);
  w.ctx.runDriveWatcher();
  // Becomes searchable only after the checkpoint moved past its modifiedTime.
  w.files.push(file('late', 'visuales', '2026-09-28T17:03:00.000Z'));
  w.ctx.runDriveWatcher();
  assert.equal(w.posts.length, 2);
  assert.match(w.posts[1], /late\.png/);
});

test('missing configuration is reported as a failure, not thrown', () => {
  const w = makeWorld({ folders: tree });
  w.props.delete('SLACK_WEBHOOK_URL');
  assert.doesNotThrow(() => w.ctx.runDriveWatcher());
  assert.match(w.props.get('DW_LAST_ERROR'), /SLACK_WEBHOOK_URL is not set/);
});
