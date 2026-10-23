// Reproduce the cost_per_run numbers in kognai-template.json with the engine's own
// estimator. Needs @kognai/build available (npx or a local install); prints JSON only.
//   node scripts/measure-cost.mjs [path-to-@kognai/build]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkgRoot = process.argv[2] || '@kognai/build';
const { estimateCost } = require(pkgRoot + '/dist/lib/cost-estimator.js');
const template = JSON.parse(require('node:fs').readFileSync(new URL('../kognai-template.json', import.meta.url)));
const tasks = [
  { id: 'plan', task_target: 'cloud-code', expected_tool_calls: 2 },
  { id: 'gather', task_target: 'cloud-exec', expected_tool_calls: 1 },
  { id: 'write', task_target: 'cloud-code', expected_tool_calls: 2 },
  { id: 'review', task_target: 'cloud-exec', expected_tool_calls: 0 },
];
const cloud = estimateCost(tasks, template);
const sovereign = estimateCost(tasks.map((t) => ({ ...t, task_target: 'local' })), template);
console.log(JSON.stringify({
  engine: 'kognai/build 0.7.10 estimateCost()',
  cloud_usd: Number(cloud.estimated_usdc.toFixed(2)),
  cloud_cap_usd: Number(cloud.max_usdc.toFixed(2)),
  sovereign_usd: Number(sovereign.estimated_usdc.toFixed(2)),
}, null, 2));
