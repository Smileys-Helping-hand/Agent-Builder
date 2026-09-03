/**
 * Build Studio API Routes
 * REST endpoints for controlling the iterative build system
 */

import express, { Request, Response } from 'express';
import { BuildStudioOrchestrator } from '../orchestrator/BuildStudioOrchestrator.js';
import { getHardwareScaler } from '../utils/HardwareScaler.js';

const router = express.Router();
let orchestrator: BuildStudioOrchestrator | null = null;

// Initialize orchestrator
export function initializeBuildStudio(workspaceRoot: string): void {
  orchestrator = new BuildStudioOrchestrator(workspaceRoot);
  orchestrator.initialize();
  
  // Set up event listeners
  orchestrator.on('session-started', (session) => {
    console.log('Event: Session started', session.id);
  });
  
  orchestrator.on('phase-changed', (phase) => {
    console.log('Event: Phase changed to', phase);
  });
  
  orchestrator.on('finished-build-ready', (data) => {
    console.log('Event: Finished build ready', data);
  });
}

// Get current state
router.get('/state', (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      return res.status(503).json({ error: 'Build Studio not initialized' });
    }
    
    const state = orchestrator.getState();
    res.json(state);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start new build session
router.post('/start', async (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      return res.status(503).json({ error: 'Build Studio not initialized' });
    }
    
    const { description, config } = req.body;
    
    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }
    
    const session = await orchestrator.startBuildSession(description, config || {});
    res.json(session);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Pause current session
router.post('/pause', async (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      return res.status(503).json({ error: 'Build Studio not initialized' });
    }
    
    await orchestrator.pauseSession();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Resume session
router.post('/resume/:sessionId', async (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      return res.status(503).json({ error: 'Build Studio not initialized' });
    }
    
    const { sessionId } = req.params;
    await orchestrator.resumeSession(sessionId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Request finished build
router.post('/finish', async (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      return res.status(503).json({ error: 'Build Studio not initialized' });
    }
    
    await orchestrator.requestFinishedBuild();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Approve improvement
router.post('/approve', async (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      return res.status(503).json({ error: 'Build Studio not initialized' });
    }
    
    const { improvementId } = req.body;
    
    if (!improvementId) {
      return res.status(400).json({ error: 'improvementId is required' });
    }
    
    const state = orchestrator.getState();
    const session = state.currentSession;
    
    if (!session) {
      return res.status(400).json({ error: 'No active session' });
    }
    
    const improvement = session.improvements.find(i => i.id === improvementId);
    
    if (!improvement) {
      return res.status(404).json({ error: 'Improvement not found' });
    }
    
    improvement.status = 'approved';
    
    res.json({ success: true, improvement });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reject improvement
router.post('/reject', async (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      return res.status(503).json({ error: 'Build Studio not initialized' });
    }
    
    const { improvementId } = req.body;
    
    if (!improvementId) {
      return res.status(400).json({ error: 'improvementId is required' });
    }
    
    const state = orchestrator.getState();
    const session = state.currentSession;
    
    if (!session) {
      return res.status(400).json({ error: 'No active session' });
    }
    
    const improvement = session.improvements.find(i => i.id === improvementId);
    
    if (!improvement) {
      return res.status(404).json({ error: 'Improvement not found' });
    }
    
    improvement.status = 'rejected';
    
    res.json({ success: true, improvement });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Shutdown Build Studio
router.post('/shutdown', async (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      return res.status(503).json({ error: 'Build Studio not initialized' });
    }
    
    await orchestrator.shutdown();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get hardware metrics
router.get('/hardware', async (req: Request, res: Response) => {
  try {
    const scaler = getHardwareScaler();
    const capabilities = scaler.getCapabilities();
    const metrics = await scaler.getUtilizationMetrics();
    
    res.json({
      cpuUsage: metrics.cpuUsage,
      memoryUsagePercent: metrics.memoryUsage,
      availableWorkers: metrics.availableWorkers,
      activeWorkers: 0,
      cpuCores: capabilities.cpuCores,
      totalMemoryGB: capabilities.totalMemoryGB,
      availableMemoryGB: capabilities.availableMemoryGB,
      canParallelize: capabilities.canParallelize
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Edit artifact
router.post('/edit', async (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      return res.status(503).json({ error: 'Build Studio not initialized' });
    }
    
    const { file, content } = req.body;
    
    if (!file || content === undefined) {
      return res.status(400).json({ error: 'file and content are required' });
    }
    
    // In production, this would update the artifact and trigger rebuild
    const state = orchestrator.getState();
    const session = state.currentSession;
    
    if (!session) {
      return res.status(400).json({ error: 'No active session' });
    }
    
    const artifact = session.artifacts.find(a => a.path === file);
    if (artifact) {
      artifact.content = content;
      artifact.modifiedAt = new Date();
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Chat with build assistant
router.post('/chat', async (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      return res.status(503).json({ error: 'Build Studio not initialized' });
    }
    
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }
    
    // Simple response for now - in production, integrate with AI
    let response = '';
    
    if (message.toLowerCase().includes('add') || message.toLowerCase().includes('create')) {
      response = "I'll add that feature to the next build iteration. Would you like me to create tests for it as well?";
    } else if (message.toLowerCase().includes('fix') || message.toLowerCase().includes('bug')) {
      response = "I'll analyze the issue and suggest a fix in the improvements tab. Should I auto-apply it?";
    } else if (message.toLowerCase().includes('optimize') || message.toLowerCase().includes('performance')) {
      response = "I'll run performance analysis and identify optimization opportunities. Check the improvements tab shortly.";
    } else {
      response = "I'm here to help! You can ask me to add features, fix issues, optimize code, or modify the build. What would you like to work on?";
    }
    
    res.json({ response });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { router as buildStudioRouter };
export { orchestrator as buildStudioOrchestrator };
