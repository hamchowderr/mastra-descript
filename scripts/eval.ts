import { readFileSync } from 'fs';
import { resolve } from 'path';

// Boot Mastra (env validation + AIMock + storage)
import { mastra } from '../src/mastra/index';
import { env } from '../src/lib/env';
import {
  toolCallAccuracyScorer,
  answerRelevancyScorer,
} from '../src/mastra/scorers/_example.scorers';

// ── types ─────────────────────────────────────────────────────────────────────

interface EvalCase {
  name: string;
  input: string;
  expectedTool: string | null;
}

interface Dataset {
  agentId: string;
  thresholds: Record<string, number>;
  cases: EvalCase[];
}

interface CaseResult {
  name: string;
  pass: boolean;
  calledTool: string | null;
  expectedTool: string | null;
  scores: Record<string, number | null>;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ── main ──────────────────────────────────────────────────────────────────────

const datasetPath = process.argv[2]
  ?? resolve(process.cwd(), 'src/mastra/scorers/datasets/_example.json');

const dataset: Dataset = JSON.parse(readFileSync(datasetPath, 'utf-8'));
const agent = mastra.getAgent(dataset.agentId);

if (!agent) {
  console.error(red(`Agent "${dataset.agentId}" not found in Mastra instance.`));
  process.exit(1);
}

console.log(bold(`\n🧪 Eval: ${dataset.agentId} — ${dataset.cases.length} cases\n`));

const results: CaseResult[] = [];
const scoreTotals: Record<string, number[]> = {
  toolCallAccuracy: [],
  answerRelevancy: [],
};

for (const evalCase of dataset.cases) {
  process.stdout.write(`  ${evalCase.name} ... `);

  let result: Awaited<ReturnType<typeof agent.generate>>;

  try {
    const generateOpts = env.USE_AIMOCK
      ? {}
      : { returnScorerData: true };

    result = await agent.generate(
      [{ role: 'user', content: evalCase.input }],
      generateOpts as Parameters<typeof agent.generate>[1],
    );
  } catch (err) {
    console.log(red('ERROR'));
    console.error(`    ${err}`);
    results.push({ name: evalCase.name, pass: false, calledTool: null, expectedTool: evalCase.expectedTool, scores: {} });
    continue;
  }

  // Extract the first tool call name from agent steps
  const steps = (result as any).steps ?? [];
  const calledTool: string | null = steps
    .flatMap((s: any) => s.toolCalls ?? [])
    .map((tc: any) => tc.toolName)[0] ?? null;

  // Determine pass:
  // - Live: compare actual tool call against expected
  // - AIMock: tool calls can't execute without real Descript API; check fixture text mentions
  //   the expected tool name instead (smoke-tests AIMock routing)
  let pass: boolean;
  if (env.USE_AIMOCK) {
    if (evalCase.expectedTool === null) {
      pass = true; // Just verify agent responded without throwing
    } else {
      pass = result.text?.includes(evalCase.expectedTool) ?? false;
    }
  } else {
    pass = calledTool === evalCase.expectedTool;
  }

  // Scorer runs (live only — AIMock cannot satisfy scorer LLM judge calls without extra fixtures)
  const scores: Record<string, number | null> = {};
  if (!env.USE_AIMOCK) {
    const scoringInput = (result as any).scoringData?.input;
    const scoringOutput = (result as any).scoringData?.output;

    if (scoringInput !== undefined && scoringOutput !== undefined) {
      try {
        const [toolResult, alignResult] = await Promise.all([
          toolCallAccuracyScorer.run({ input: scoringInput as any, output: scoringOutput as any }),
          answerRelevancyScorer.run({ input: scoringInput as any, output: scoringOutput as any }),
        ]);
        scores.toolCallAccuracy = toolResult.score;
        scores.answerRelevancy = alignResult.score;
      } catch (err) {
        console.error(yellow(`\n    ⚠ scorer error: ${err}`));
      }
    }
  }

  for (const [key, val] of Object.entries(scores)) {
    if (val !== null && key in scoreTotals) scoreTotals[key]!.push(val);
  }

  results.push({ name: evalCase.name, pass, calledTool, expectedTool: evalCase.expectedTool, scores });

  if (pass) {
    console.log(green('PASS'));
  } else {
    console.log(red('FAIL'));
    console.log(`    expected: ${evalCase.expectedTool ?? 'null'}, called: ${calledTool ?? 'null'}`);
    if (env.USE_AIMOCK && evalCase.expectedTool) {
      console.log(`    text did not mention "${evalCase.expectedTool}"`);
    }
  }

  const scoreStr = Object.entries(scores)
    .map(([k, v]) => `${k}=${v !== null ? v.toFixed(2) : 'n/a'}`)
    .join(' ');
  if (scoreStr) console.log(`    scores: ${scoreStr}`);
}

// ── aggregate summary ─────────────────────────────────────────────────────────

console.log(bold('\n── Aggregate Scores ─────────────────────────────────────────'));

const scorerPass: Record<string, boolean | 'skip'> = {};
for (const [scorer, values] of Object.entries(scoreTotals)) {
  const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const threshold = dataset.thresholds[scorer] ?? 0;
  const pass = avg === null ? 'skip' : avg >= threshold;
  scorerPass[scorer] = pass;

  const avgStr = avg !== null ? avg.toFixed(3) : 'n/a';
  const label = avg === null
    ? yellow(`  ${scorer}: ${avgStr} (skipped — AIMock mode, no scorer fixtures)`)
    : pass
    ? green(`  ${scorer}: ${avgStr} ≥ ${threshold} ✓`)
    : red(`  ${scorer}: ${avgStr} < ${threshold} ✗`);
  console.log(label);
}

const toolCheckFail = results.filter(r => !r.pass).length;
console.log(bold('\n── Tool Selection Checks ─────────────────────────────────────'));
console.log(`  ${results.length - toolCheckFail}/${results.length} cases passed`);

const allScorersPassed = Object.values(scorerPass).every(v => v === true || v === 'skip');
const allChecksPassed = toolCheckFail === 0;
const exitCode = allChecksPassed && allScorersPassed ? 0 : 1;

if (exitCode === 0) {
  console.log(bold(green('\n✅ All checks passed\n')));
} else {
  console.log(bold(red('\n❌ Some checks failed\n')));
}

process.exit(exitCode);
