#!/usr/bin/env node
/**
 * Build Studio CLI - Command line interface for iterative development
 */

import { Command } from 'commander';
import { BuildStudioOrchestrator } from '../orchestrator/BuildStudioOrchestrator.js';
import { initResourceManager } from '../utils/ResourceManager.js';
import readline from 'readline';

const program = new Command();

program
  .name('build-studio')
  .description('Iterative development system with real-time preview and continuous improvement')
  .version('1.0.0');

program
  .command('start')
  .description('Start a new iterative build session')
  .option('-d, --description <description>', 'What to build')
  .option('-r, --ram <mb>', 'RAM limit in MB', '4096')
  .option('-m, --mode <mode>', 'Preview mode (CODE|UI|ARCHITECTURE|HYBRID)', 'CODE')
  .option('-s, --strictness <level>', 'Test strictness (lenient|normal|strict)', 'normal')
  .option('--auto-approve', 'Auto-approve minor fixes', false)
  .option('--max-iterations <number>', 'Maximum iterations', '100')
  .action(async (options) => {
    try {
      const workspaceRoot = process.cwd();
      const orchestrator = new BuildStudioOrchestrator(workspaceRoot);
      
      await orchestrator.initialize();
      
      let description = options.description;
      if (!description) {
        description = await prompt('What would you like to build? ');
      }
      
      console.log('\n🚀 Starting Build Studio...\n');
      
      const session = await orchestrator.startBuildSession(description, {
        ramLimitMB: parseInt(options.ram),
        previewMode: options.mode,
        testStrictness: options.strictness,
        autoApproveMinorFixes: options.autoApprove,
        maxIterations: parseInt(options.maxIterations),
        requireTestsToPass: true,
        enableHotReload: true
      });
      
      console.log(`\n✅ Session started: ${session.id}`);
      console.log(`📺 Preview available at: http://localhost:3500`);
      console.log(`📊 Dashboard available at: http://localhost:3000\n`);
      
      // Set up event handlers
      orchestrator.on('phase-changed', (phase) => {
        console.log(`\n🔄 Phase: ${phase}`);
      });
      
      orchestrator.on('finished-build-ready', (data) => {
        console.log(`\n✨ Finished build ready!`);
        console.log(`   Output: ${data.outputPath}`);
        console.log(`   Artifacts: ${data.artifactCount}`);
      });
      
      // Handle user input
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      rl.on('line', async (input) => {
        const cmd = input.trim().toLowerCase();
        
        if (cmd === 'finished build' || cmd === 'finish') {
          console.log('\n📦 Requesting finished build...');
          await orchestrator.requestFinishedBuild();
        } else if (cmd === 'pause') {
          await orchestrator.pauseSession();
        } else if (cmd === 'status') {
          const state = orchestrator.getState();
          console.log('\n📊 Current Status:');
          console.log(`   Phase: ${state.currentSession?.phase}`);
          console.log(`   Iteration: ${state.currentSession?.iterationCount}`);
          console.log(`   RAM: ${state.resourceAllocation.currentRamMB}/${state.resourceAllocation.maxRamMB}MB`);
          console.log(`   Artifacts: ${state.currentSession?.artifacts.length}`);
        } else if (cmd === 'help') {
          console.log('\n📚 Commands:');
          console.log('   finished build - Create production-ready build');
          console.log('   pause          - Pause current session');
          console.log('   status         - Show current status');
          console.log('   help           - Show this help');
          console.log('   exit           - Exit Build Studio');
        } else if (cmd === 'exit' || cmd === 'quit') {
          console.log('\n👋 Shutting down...');
          await orchestrator.shutdown();
          process.exit(0);
        }
      });
      
      console.log('💬 Type "help" for commands, "finished build" to export, or "exit" to quit\n');
      
      // Keep process alive
      process.on('SIGINT', async () => {
        console.log('\n\n🛑 Received SIGINT, shutting down...');
        await orchestrator.shutdown();
        process.exit(0);
      });
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

program
  .command('resume <sessionId>')
  .description('Resume a paused build session')
  .action(async (sessionId) => {
    try {
      const workspaceRoot = process.cwd();
      const orchestrator = new BuildStudioOrchestrator(workspaceRoot);
      
      await orchestrator.initialize();
      await orchestrator.resumeSession(sessionId);
      
      console.log(`✅ Session ${sessionId} resumed`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all build sessions')
  .action(async () => {
    try {
      const workspaceRoot = process.cwd();
      const { BuildSessionManager } = await import('../orchestrator/BuildSessionManager.js');
      const manager = new BuildSessionManager(workspaceRoot);
      
      await manager.initialize();
      const sessions = await manager.listSessions();
      
      console.log(`\n📋 Build Sessions (${sessions.length}):\n`);
      
      for (const session of sessions) {
        console.log(`   ${session.id}`);
        console.log(`   Name: ${session.projectName}`);
        console.log(`   Phase: ${session.phase}`);
        console.log(`   Iteration: ${session.iterationCount}`);
        console.log(`   Started: ${new Date(session.startedAt).toLocaleString()}`);
        if (session.completedAt) {
          console.log(`   Completed: ${new Date(session.completedAt).toLocaleString()}`);
        }
        console.log('');
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

program.parse();
