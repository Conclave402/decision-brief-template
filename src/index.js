'use strict';
/**
 * Decision Brief: a product template for the Kognai engine (@kognai/build 0.7+).
 *
 * planRun(input, outDir) turns the user's brief into engine arguments.
 * runTemplate(input, {outDir, exec}) runs the engine through the injected exec,
 * shapes whatever it wrote into product files, and returns them with the cost.
 *
 * No secret ever goes into the arguments: the engine reads its own environment.
 * Node 20 or later. No dependencies.
 */
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE_ID = 'decision-brief-default';
const TEMPLATE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kognai-template.json'), 'utf8'));

const SECRET_SHAPED = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /ANTHROPIC_API_KEY/i,
  /api[_-]?key\s*[=:]/i,
  /0x[0-9a-fA-F]{64}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function assertNoSecret(value, where) {
  const text = String(value);
  for (const re of SECRET_SHAPED) {
    if (re.test(text)) throw new Error(where + ' looks like it contains a secret; pass the brief, never a key');
  }
}

function cleanBrief(input) {
  const brief = input && input.brief;
  if (typeof brief !== 'string' || brief.trim().length < 8) {
    throw new Error('input.brief must be a string of at least 8 characters');
  }
  if (brief.length > 4000) throw new Error('input.brief must be at most 4000 characters');
  assertNoSecret(brief, 'input.brief');
  return brief.trim();
}

/** The goal text handed to the engine: the brief plus the shape the product needs. */
function goalText(brief, audience) {
  const parts = [
    'Write a decision brief that answers this request: ' + brief,
    'Structure it as Markdown with these sections in order: Summary (three sentences at most),',
    'What we know, What we do not know, Options, Recommendation, Open questions.',
    'Keep every factual claim traceable to a named source; mark anything unverified as unverified.',
    'Use Latin digits and avoid long dashes.',
  ];
  if (audience) parts.splice(1, 0, 'The reader is: ' + audience + '.');
  return parts.join(' ');
}

/**
 * planRun(input, outDir) -> {args: string[]}
 * args are engine arguments: --goal, --out-dir (a folder inside outDir), and
 * --sovereign when input.sovereign is true. Never a key.
 */
function planRun(input, outDir) {
  const brief = cleanBrief(input);
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('outDir must be a non-empty path');
  }
  const audience = input && typeof input.audience === 'string' ? input.audience.trim() : '';
  const goal = goalText(brief, audience);
  assertNoSecret(goal, 'goal');
  const engineDir = path.join(outDir, 'engine');
  const args = ['--goal', goal, '--out-dir', engineDir];
  if (input && input.sovereign === true) args.push('--sovereign');
  return { args };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function parseCost(stdout, sovereign) {
  if (sovereign) return 0;
  const text = String(stdout || '');
  const footer = text.match(/Total:[^\n]*\$\s*([0-9]+(?:\.[0-9]+)?)/);
  const field = text.match(/"?cost_usd"?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/);
  const raw = (footer && footer[1]) || (field && field[1]);
  if (!raw) throw new Error('engine output did not report a cost; cannot return cost_usd');
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error('engine reported an unusable cost');
  return value;
}

function shape(engineDir, outDir, brief, costUsd, sovereign) {
  const engineFiles = walk(engineDir);
  if (engineFiles.length === 0) {
    throw new Error('engine wrote no files to ' + engineDir);
  }
  const sections = engineFiles
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({
      name: path.relative(engineDir, f),
      body: fs.readFileSync(f, 'utf8').trim(),
    }));
  if (sections.length === 0) {
    throw new Error('engine wrote no Markdown, so there is no brief to shape');
  }
  const header = [
    '# Decision brief',
    '',
    'Request: ' + brief,
    '',
    'Template: ' + TEMPLATE_ID + ' (engine @kognai/build 0.7+)',
    'Mode: ' + (sovereign ? 'sovereign (local, 0 USD)' : 'cloud'),
    'Engine cost for this run: ' + costUsd.toFixed(4) + ' USD',
    '',
    '---',
    '',
  ].join('\n');
  const body = sections.map((s) => s.body).join('\n\n---\n\n');
  const briefMd = path.join(outDir, 'brief.md');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(briefMd, header + body + '\n');
  const manifest = {
    template_id: TEMPLATE_ID,
    template_name: TEMPLATE.name,
    brief,
    mode: sovereign ? 'sovereign' : 'cloud',
    cost_usd: costUsd,
    engine_files: engineFiles.map((f) => path.relative(engineDir, f)),
    product_files: ['brief.md', 'brief.json'],
  };
  const manifestPath = path.join(outDir, 'brief.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return [briefMd, manifestPath];
}

/** Default runner: npx @kognai/build through the child process. Injected in tests. */
async function defaultExec(args) {
  const { spawn } = require('node:child_process');
  return await new Promise((resolve) => {
    const child = spawn('npx', ['--yes', '@kognai/build@0.7', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ code: 127, stdout, stderr: String((err && err.message) || err) }));
    child.on('close', (code) => resolve({ code: code === null ? 1 : code, stdout, stderr }));
  });
}

/**
 * runTemplate(input, {outDir, exec}) -> {outDir, files, cost_usd}
 * exec(args) -> Promise<{code, stdout, stderr}> runs the engine; tests inject it.
 */
async function runTemplate(input, options) {
  const opts = options || {};
  const outDir = opts.outDir;
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('options.outDir must be a non-empty path');
  }
  const exec = typeof opts.exec === 'function' ? opts.exec : defaultExec;
  const sovereign = Boolean(input && input.sovereign === true);
  const { args } = planRun(input, outDir);
  const result = await exec(args);
  const code = result && typeof result.code === 'number' ? result.code : 1;
  if (code !== 0) {
    const reason = String((result && result.stderr) || '').trim().split('\n').slice(-3).join(' ').slice(0, 300);
    throw new Error('engine failed with exit code ' + code + (reason ? ': ' + reason : ''));
  }
  const costUsd = parseCost(result && result.stdout, sovereign);
  const engineDir = path.join(outDir, 'engine');
  if (!fs.existsSync(engineDir)) throw new Error('engine wrote nothing: output directory is missing');
  const products = shape(engineDir, outDir, cleanBrief(input), costUsd, sovereign);
  const files = products.map((f) => path.relative(outDir, f)).sort();
  return { outDir, files, cost_usd: costUsd };
}

module.exports = { planRun, runTemplate, goalText, parseCost, TEMPLATE, TEMPLATE_ID, defaultExec };
