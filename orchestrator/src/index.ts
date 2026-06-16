/**
 * Birdie Orchestrator
 *
 * The master agent that routes tasks to the appropriate project sub-agent.
 * Each project under Birdie (e.g. Relay) has its own managed sub-agent.
 *
 * Usage:
 *   npm run dev                        # interactive REPL
 *   npm run dev -- --task "..."        # one-shot task
 */

import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { orchestrate } from './orchestrator.js';

const args = process.argv.slice(2);
const taskFlag = args.indexOf('--task');

if (taskFlag !== -1 && args[taskFlag + 1]) {
  // One-shot mode
  const task = args[taskFlag + 1];
  console.log(`\nBirdie Orchestrator — running task:\n${task}\n`);
  const result = await orchestrate(task);
  console.log('\n--- Result ---\n');
  console.log(result);
  process.exit(0);
} else {
  // Interactive REPL
  const rl = readline.createInterface({ input, output });
  console.log('\nBirdie Orchestrator — interactive mode');
  console.log('Type your task and press Enter. Type "exit" to quit.\n');

  while (true) {
    const task = await rl.question('> ');
    if (task.trim().toLowerCase() === 'exit') {
      console.log('Goodbye.');
      rl.close();
      break;
    }
    if (!task.trim()) continue;

    const result = await orchestrate(task);
    console.log('\n--- Result ---\n');
    console.log(result);
    console.log('\n');
  }
}
