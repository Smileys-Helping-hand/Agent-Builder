# Build Studio - Iterative Development System

**Transform your Agent-Builder into an intelligent, iterative development environment that builds, tests, and continuously improves applications until they're perfect.**

## 🎯 Overview

Build Studio is a revolutionary approach to software development that replaces traditional one-shot code generation with a **continuous build-preview-test-improve cycle**. Instead of asking for something and receiving a single output, the system:

1. **Builds iteratively** - Creates features step-by-step
2. **Tests automatically** - Validates every change
3. **Analyzes intelligently** - Finds issues and improvement opportunities  
4. **Prompts for feedback** - Asks your approval before applying fixes
5. **Improves continuously** - Repeats until you say "finished build"

## ✨ Key Features

### 🔄 **Continuous Iteration Cycle**
- **PLANNING** → **BUILDING** → **PREVIEWING** → **TESTING** → **ANALYZING** → **IMPROVING** → repeat
- Each iteration refines and enhances the application
- Only exports when you explicitly request "finished build"

### 💾 **RAM Resource Management**
- Set custom memory limits (e.g., "use 4GB max")
- Real-time monitoring and usage tracking
- Automatic throttling when approaching limits
- Memory profiling for each build phase

### 👁️ **Live Preview System**
- Watch code being generated in real-time
- WebSocket-based streaming updates
- Multiple preview modes: CODE, UI, ARCHITECTURE, HYBRID
- Hot-reload capability for instant feedback
- Diff viewer showing changes between iterations

### 🧪 **Automated Testing**
- Auto-generates tests for built features
- Runs unit, integration, functional, and regression tests
- Calculates code coverage
- Identifies test failures for improvement loop
- Detailed test reports with pass/fail metrics

### 💡 **AI-Powered Improvements**
- Analyzes test results for failures
- Scans code quality (file size, error handling, debug code)
- Evaluates performance metrics
- Prioritizes suggestions by impact
- Shows benefit scores and risk levels

### 💬 **Interactive Feedback**
- Prompts at key decision points
- Shows improvement suggestions with explanations
- Approve/reject/modify actions
- Auto-approve minor fixes (configurable)
- Learns from your preferences over time

### 📊 **Build Studio Dashboard**
- Real-time build progress visualization
- Live preview pane with code/UI view
- Test results panel with pass/fail stats
- Improvement suggestions queue
- RAM usage graphs
- Interactive timeline of all events
- Pause/resume/rollback controls

### 📦 **Production Packaging**
- Creates optimized builds only on "finished build" command
- Minification and bundling
- Multi-platform export options
- Deployment documentation generation

### 💾 **Session Persistence**
- Auto-saves every 30 seconds
- Resume interrupted builds anytime
- Full build history with rollback capability
- Session metadata and statistics

## 🚀 Quick Start

### Installation

The Build Studio is integrated into your Agent-Builder. No additional installation needed!

### Starting a Build Session

**Via CLI:**
```bash
npm run build-studio:start
```

Or with options:
```bash
build-studio start \
  --description "Build a todo app with user auth" \
  --ram 4096 \
  --mode CODE \
  --strictness normal \
  --auto-approve
```

**Via API:**
```typescript
import { BuildStudioOrchestrator } from './orchestrator/BuildStudioOrchestrator';

const orchestrator = new BuildStudioOrchestrator(workspaceRoot);
await orchestrator.initialize();

const session = await orchestrator.startBuildSession(
  "Build a todo app",
  {
    ramLimitMB: 4096,
    previewMode: 'CODE',
    testStrictness: 'normal',
    enableHotReload: true
  }
);
```

### Accessing the Dashboard

Once started:
- **Preview Server**: http://localhost:3500
- **Web Dashboard**: http://localhost:3000
- **API Endpoint**: http://localhost:3000/api/build-studio

## 📋 Usage Workflow

### 1. Start Session
```bash
build-studio start --description "Build a REST API with Express"
```

### 2. Monitor Progress
The system automatically:
- Plans the architecture
- Builds components incrementally
- Shows live preview
- Runs tests after each build
- Analyzes for improvements

### 3. Review Improvements
When issues are found:
```
💡 Improvement Suggestions:

1. [HIGH] Fix failing test: should_validate_input
   Expected validation to reject invalid email format
   Impact: 90/100 | Risk: low | Complexity: simple
   
   ✓ Approve  ✗ Reject
```

### 4. Approve/Reject
- Type `approve` to apply the fix
- System applies change, re-tests, continues
- Cycle repeats until all tests pass

### 5. Request Finished Build
When satisfied:
```bash
finished build
```

System creates optimized, production-ready package.

## ⚙️ Configuration

### Build Session Config

```typescript
interface BuildSessionConfig {
  ramLimitMB: number;                    // RAM allocation (default: 4096)
  previewMode: PreviewMode;               // CODE|UI|ARCHITECTURE|HYBRID
  testStrictness: 'lenient'|'normal'|'strict';
  improvementAggressiveness: 'conservative'|'balanced'|'aggressive';
  autoApproveMinorFixes: boolean;        // Auto-approve trivial fixes
  maxIterations: number;                 // Max iteration limit (default: 100)
  requireTestsToPass: boolean;           // Block on test failures
  enableHotReload: boolean;              // Live preview updates
}
```

### Example Configurations

**Fast Development (Lenient Testing)**
```typescript
{
  ramLimitMB: 2048,
  previewMode: 'CODE',
  testStrictness: 'lenient',
  improvementAggressiveness: 'aggressive',
  autoApproveMinorFixes: true,
  maxIterations: 50,
  requireTestsToPass: false,
  enableHotReload: true
}
```

**Production Quality (Strict Testing)**
```typescript
{
  ramLimitMB: 8192,
  previewMode: 'HYBRID',
  testStrictness: 'strict',
  improvementAggressiveness: 'conservative',
  autoApproveMinorFixes: false,
  maxIterations: 200,
  requireTestsToPass: true,
  enableHotReload: true
}
```

## 📊 Dashboard Features

### Preview Tab
- Live code preview with syntax highlighting
- UI preview for web components
- Architecture diagrams
- Real-time diff viewer
- Hot-reload indicator

### Tests Tab
- Test run history
- Pass/fail statistics
- Coverage metrics
- Failed test details with error messages
- Regression detection

### Improvements Tab
- Prioritized suggestion queue
- Impact scores and risk levels
- Approve/reject buttons
- Affected files list
- Rationale explanations

### Timeline Tab
- Chronological event history
- Phase transitions
- Artifact creations
- Test runs
- Improvements applied
- User feedback

## 🔧 Advanced Features

### Session Management

**List all sessions:**
```bash
build-studio list
```

**Resume paused session:**
```bash
build-studio resume session-abc123
```

**Pause current session:**
```bash
pause
```

### CLI Commands

During an active session:
- `finished build` - Create production build
- `pause` - Pause session
- `status` - Show current status
- `help` - Show available commands
- `exit` - Shutdown Build Studio

### Event System

Subscribe to events:
```typescript
orchestrator.on('session-started', (session) => {
  console.log('Session started:', session.id);
});

orchestrator.on('phase-changed', (phase) => {
  console.log('Now in phase:', phase);
});

orchestrator.on('finished-build-ready', (data) => {
  console.log('Build ready:', data.outputPath);
});
```

### API Endpoints

- `GET /api/build-studio/state` - Get current state
- `POST /api/build-studio/start` - Start new session
- `POST /api/build-studio/pause` - Pause session
- `POST /api/build-studio/resume/:id` - Resume session
- `POST /api/build-studio/finish` - Request finished build
- `POST /api/build-studio/approve` - Approve improvement
- `POST /api/build-studio/reject` - Reject improvement

## 🎓 Best Practices

### RAM Allocation
- **Development**: 2-4GB for smaller projects
- **Production**: 4-8GB for complex applications
- **Large-scale**: 8-16GB for microservices/monorepos

### Test Strictness
- **lenient**: Fast iteration, allow some failures
- **normal**: Balanced approach (recommended)
- **strict**: No failures allowed, highest quality

### Improvement Aggressiveness
- **conservative**: Only critical fixes
- **balanced**: Important improvements (recommended)
- **aggressive**: All suggestions, faster improvement

### Auto-Approve Settings
Enable for:
- Removing console.log statements
- Fixing typos and formatting
- Trivial refactorings

Disable for:
- Production builds
- Security-critical applications
- Complex refactorings

## 🐛 Troubleshooting

### Build Studio Won't Start
- Check port 3500 is available (preview)
- Ensure workspace has write permissions
- Verify Node.js version >= 18

### High Memory Usage
- Reduce `ramLimitMB` setting
- Enable throttling (automatic)
- Check for memory leaks in generated code

### Tests Always Failing
- Review test generation logic
- Check strictness level
- Examine error messages in dashboard

### Preview Not Updating
- Verify WebSocket connection
- Check hot-reload is enabled
- Refresh browser/reconnect

## 🔮 Future Enhancements

- [ ] Multi-language support (Python, Java, Go)
- [ ] Cloud-based preview sharing
- [ ] Collaborative multi-user sessions
- [ ] AI-powered test generation improvements
- [ ] Integration with CI/CD pipelines
- [ ] Visual diff editor
- [ ] Performance profiling and optimization
- [ ] Docker container integration
- [ ] Voice command support

## 📝 Examples

### Example 1: Building a REST API
```bash
build-studio start --description "Express REST API with authentication"
```

**Iteration 1**: Creates basic server structure
**Iteration 2**: Adds routes and middleware
**Iteration 3**: Implements authentication
**Tests**: Validates endpoints and auth flow
**Improvements**: Adds error handling, optimizes queries
**Result**: Production-ready API

### Example 2: React Dashboard
```bash
build-studio start \
  --description "React dashboard with charts and data tables" \
  --mode UI \
  --ram 6144
```

**Iteration 1**: Component structure
**Iteration 2**: State management setup
**Iteration 3**: Chart integration
**Tests**: Component rendering, interactions
**Improvements**: Performance optimization, responsive design
**Result**: Polished dashboard

## 📚 Resources

- [API Reference](./API_REFERENCE.md)
- [Implementation Details](./IMPLEMENTATION_COMPLETE.md)
- [Architecture Overview](./AUTONOMOUS_ORCHESTRATION.md)

## 🤝 Contributing

Build Studio is part of Agent-Builder. Contributions welcome!

## 📄 License

MIT License - see LICENSE file

---

**Built with ❤️ by the Agent-Builder team**
