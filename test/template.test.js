'use strict';
// Each test is named after the acceptance item it proves (house rule A1..A6).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { planRun, runTemplate, TEMPLATE } = require('../src/index.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decision-brief-'));
}

function fakeEngine({ files = { 'brief/notes.md': '# Notes\n\nA source-backed note.' }, code = 0, stdout = '   Total: 41s · 9 model calls · $0.0123\n', stderr = '', costOnly = false } = {}) {
  return async (args) => {
    const i = args.indexOf('--out-dir');
    const dir = args[i + 1];
    if (code === 0 && !costOnly) {
      for (const [rel, body] of Object.entries(files)) {
        const full = path.join(dir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
      }
    }
    return { code, stdout, stderr };
  };
}

test('A1 kognai-template.json has the engine template fields and a cost per run', () => {
  for (const key of ['id', 'name', 'intent', 'default_profile', 'composition', 'workflow', 'skills', 'tools']) {
    assert.ok(key in TEMPLATE, 'missing field ' + key);
  }
  assert.ok(Array.isArray(TEMPLATE.intent) && TEMPLATE.intent.length > 0);
  assert.ok(typeof TEMPLATE.default_profile.primary === 'string');
  assert.ok(Array.isArray(TEMPLATE.default_profile.secondary));
  assert.ok(Array.isArray(TEMPLATE.composition.roles) && TEMPLATE.composition.roles.length > 0);
  for (const r of TEMPLATE.composition.roles) {
    assert.ok(typeof r.role === 'string' && Number.isInteger(r.count) && r.count > 0);
  }
  const c = TEMPLATE.cost_per_run;
  assert.ok(c && typeof c === 'object', 'cost_per_run missing');
  for (const key of ['cloud_usd', 'sovereign_usd', 'measured_on', 'runs']) {
    assert.ok(key in c, 'cost_per_run.' + key + ' missing');
  }
  assert.ok(Number.isFinite(c.cloud_usd) && c.cloud_usd >= 0);
  assert.ok(Number.isFinite(c.sovereign_usd) && c.sovereign_usd >= 0);
  assert.ok(typeof c.measured_on === 'string' && c.measured_on.length > 10);
  assert.ok(Number.isInteger(c.runs) && c.runs >= 0);
});

test('A2 planRun turns an input into engine arguments with the output directory, sovereign when asked, and no secret', () => {
  const dir = tmpdir();
  const plain = planRun({ brief: 'Compare two paid x402 APIs for a small trading agent' }, dir);
  assert.ok(Array.isArray(plain.args));
  const goalAt = plain.args.indexOf('--goal');
  assert.ok(goalAt >= 0, 'no --goal');
  assert.match(plain.args[goalAt + 1], /Compare two paid x402 APIs/);
  const outAt = plain.args.indexOf('--out-dir');
  assert.ok(outAt >= 0, 'no --out-dir');
  assert.strictEqual(plain.args[outAt + 1], path.join(dir, 'engine'));
  assert.ok(!plain.args.includes('--sovereign'));

  const local = planRun({ brief: 'Compare two paid x402 APIs for a small trading agent', sovereign: true }, dir);
  assert.ok(local.args.includes('--sovereign'));

  for (const args of [plain.args, local.args]) {
    const text = args.join(' ');
    assert.ok(!/sk-[A-Za-z0-9_-]{16,}/.test(text), 'a key-shaped string reached the arguments');
    assert.ok(!/0x[0-9a-fA-F]{64}/.test(text), 'a private-key-shaped string reached the arguments');
  }
  assert.throws(() => planRun({ brief: 'use sk-ant-abcdefghijklmnopqrstuvwx for this' }, dir), /secret/);
  assert.throws(() => planRun({ brief: 'short' }, dir), /brief/);
});

test('A3 runTemplate runs the engine through exec, shapes the output into product files and returns them with the cost', async () => {
  const dir = tmpdir();
  const calls = [];
  const exec = fakeEngine();
  const run = await runTemplate({ brief: 'Which paid x402 data feed should a small agent buy first?' }, {
    outDir: dir,
    exec: async (args) => { calls.push(args); return exec(args); },
  });
  assert.strictEqual(calls.length, 1, 'engine must run exactly once');
  assert.strictEqual(run.outDir, dir);
  assert.deepStrictEqual(run.files, ['brief.json', 'brief.md']);
  assert.strictEqual(run.cost_usd, 0.0123);
  const md = fs.readFileSync(path.join(dir, 'brief.md'), 'utf8');
  assert.match(md, /^# Decision brief/);
  assert.match(md, /A source-backed note\./);
  assert.match(md, /Engine cost for this run: 0\.0123 USD/);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8'));
  assert.strictEqual(manifest.cost_usd, 0.0123);
  assert.strictEqual(manifest.mode, 'cloud');
  assert.deepStrictEqual(manifest.engine_files, ['brief/notes.md']);
});

test('A3b a sovereign run reports zero cost and routes the engine locally', async () => {
  const dir = tmpdir();
  let seen = null;
  const run = await runTemplate({ brief: 'Is a local model good enough for this brief?', sovereign: true }, {
    outDir: dir,
    exec: async (args) => { seen = args; return fakeEngine()(args); },
  });
  assert.ok(seen.includes('--sovereign'));
  assert.strictEqual(run.cost_usd, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8'));
  assert.strictEqual(manifest.mode, 'sovereign');
});

test('A4 an engine failure or an empty output is rejected with a plain reason', async () => {
  const dir = tmpdir();
  await assert.rejects(
    runTemplate({ brief: 'A brief whose engine run fails' }, {
      outDir: dir,
      exec: fakeEngine({ code: 2, stderr: 'no ANTHROPIC_API_KEY and no local model' }),
    }),
    (err) => /engine failed with exit code 2/.test(err.message) && /no ANTHROPIC_API_KEY/.test(err.message),
  );
  const dir2 = tmpdir();
  await assert.rejects(
    runTemplate({ brief: 'A brief whose engine writes nothing' }, { outDir: dir2, exec: fakeEngine({ costOnly: true }) }),
    /wrote nothing/,
  );
  const dir3 = tmpdir();
  await assert.rejects(
    runTemplate({ brief: 'A brief with empty engine output' }, { outDir: dir3, exec: fakeEngine({ files: {} }) }),
    /wrote nothing|no files/,
  );
});

test.todo('A5 builds and runs from a clean machine: lockfile, no install script, npm test offline (checked by ./scripts/clean-check.sh)');

test.todo('A6 README states what it makes, cloud and sovereign runs, cost per run, and examples/ holds a real sample output (M2)');
