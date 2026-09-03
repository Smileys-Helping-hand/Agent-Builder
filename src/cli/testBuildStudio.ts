#!/usr/bin/env node
/**
 * Build Studio Test Runner
 * Comprehensive testing and validation script
 */

import { BuildStudioOrchestrator } from '../orchestrator/BuildStudioOrchestrator.js';
import { getHardwareScaler } from '../utils/HardwareScaler.js';
import { initResourceManager } from '../utils/ResourceManager.js';

async function runTests() {
  console.log('\n🧪 Build Studio - System Test Suite\n');
  console.log('═'.repeat(50));
  
  const results: { test: string; passed: boolean; message?: string }[] = [];
  
  try {
    // Test 1: Hardware Detection
    console.log('\n📊 Test 1: Hardware Detection');
    const scaler = getHardwareScaler();
    const capabilities = scaler.getCapabilities();
    
    console.log(`   CPU Cores: ${capabilities.cpuCores}`);
    console.log(`   Available Memory: ${capabilities.availableMemoryGB.toFixed(2)}GB`);
    console.log(`   Can Parallelize: ${capabilities.canParallelize}`);
    console.log(`   Recommended Workers: ${capabilities.recommendedWorkers}`);
    
    results.push({
      test: 'Hardware Detection',
      passed: capabilities.cpuCores > 0 && capabilities.availableMemoryGB > 0
    });
    
    // Test 2: Resource Manager
    console.log('\n💾 Test 2: Resource Manager');
    const resourceManager = initResourceManager(2048); // 2GB limit
    const usage = resourceManager.getCurrentUsage();
    
    console.log(`   RAM Limit: ${usage.maxRamMB}MB`);
    console.log(`   Current Usage: ${usage.currentRamMB}MB`);
    console.log(`   CPU Usage: ${usage.cpuPercentage}%`);
    
    results.push({
      test: 'Resource Manager',
      passed: usage.maxRamMB === 2048
    });
    
    // Test 3: Parallel Execution
    console.log('\n⚡ Test 3: Parallel Execution');
    const startTime = Date.now();
    
    const tasks = Array(10).fill(null).map((_, i) => () => {
      return new Promise<number>(resolve => {
        setTimeout(() => resolve(i), 100);
      });
    });
    
    const parallelResults = await scaler.executeParallel(tasks);
    const parallelTime = Date.now() - startTime;
    
    console.log(`   Executed ${parallelResults.length} tasks in ${parallelTime}ms`);
    console.log(`   Expected ~100ms with parallelization`);
    
    results.push({
      test: 'Parallel Execution',
      passed: parallelResults.length === 10 && parallelTime < 500
    });
    
    // Test 4: Build Studio Initialization
    console.log('\n🚀 Test 4: Build Studio Initialization');
    const workspaceRoot = process.cwd();
    const orchestrator = new BuildStudioOrchestrator(workspaceRoot);
    
    await orchestrator.initialize();
    
    console.log('   ✓ Orchestrator initialized');
    
    results.push({
      test: 'Build Studio Initialization',
      passed: true
    });
    
    // Test 5: Session Creation
    console.log('\n📝 Test 5: Session Creation');
    const session = await orchestrator.startBuildSession(
      'Test application',
      {
        ramLimitMB: 2048,
        previewMode: 'CODE' as any,
        testStrictness: 'lenient',
        improvementAggressiveness: 'balanced',
        autoApproveMinorFixes: false,
        maxIterations: 5,
        requireTestsToPass: false,
        enableHotReload: true
      }
    );
    
    console.log(`   Session ID: ${session.id}`);
    console.log(`   Phase: ${session.phase}`);
    
    results.push({
      test: 'Session Creation',
      passed: session.id.length > 0
    });
    
    // Test 6: Auto-scaling
    console.log('\n📈 Test 6: Auto-scaling');
    const initialMetrics = await scaler.getUtilizationMetrics();
    const initialWorkers = initialMetrics.availableWorkers;
    await scaler.scaleUp();
    const scaledMetrics = await scaler.getUtilizationMetrics();
    const scaledWorkers = scaledMetrics.availableWorkers;
    
    console.log(`   Initial Workers: ${initialWorkers}`);
    console.log(`   Scaled Workers: ${scaledWorkers}`);
    
    results.push({
      test: 'Auto-scaling',
      passed: scaledWorkers >= initialWorkers
    });
    
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await orchestrator.shutdown();
    await resourceManager.cleanup();
    
    // Print Results
    console.log('\n═'.repeat(50));
    console.log('\n📊 Test Results:\n');
    
    let passed = 0;
    let failed = 0;
    
    results.forEach(result => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`   ${status} - ${result.test}`);
      if (result.message) {
        console.log(`         ${result.message}`);
      }
      
      if (result.passed) passed++;
      else failed++;
    });
    
    console.log('\n═'.repeat(50));
    console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
    
    if (failed === 0) {
      console.log('\n✨ All tests passed! Build Studio is ready to use.\n');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some tests failed. Please review the output above.\n');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests
runTests();
