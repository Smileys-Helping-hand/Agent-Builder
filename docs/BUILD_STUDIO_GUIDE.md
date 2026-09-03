# Build Studio - Complete Guide

## 🎯 Overview

Build Studio is your **constant building partner** - an iterative development system that builds, tests, previews, and improves applications automatically. It's designed to work within your hardware constraints while continuously refining your app until it's perfect.

## ✨ Key Features

### 1. **Iterative Build System**
- Automatically cycles through planning → building → testing → improving
- Learns from each iteration and applies improvements
- Works until you say stop or reaches perfection

### 2. **RAM Management**
- Set a specific RAM limit for builds
- System respects your allocation while maximizing efficiency
- Real-time memory monitoring and throttling

### 3. **Live Preview Dashboard**
- See builds in real-time as they happen
- Interactive code editor - modify artifacts on the fly
- AI chat assistant for guidance and modifications
- Hardware utilization metrics

### 4. **Hardware Scaling**
- Automatically detects your system capabilities (CPU cores, RAM)
- Parallel execution of build tasks
- Auto-scales based on current system load
- Optimizes for CPU-intensive vs memory-intensive tasks

### 5. **Continuous Improvement**
- Analyzes test results for failures and optimizations
- Checks code quality and suggests improvements
- Prioritizes fixes by severity and impact
- Learns from previous iterations

## 🚀 Quick Start

### Start a Build Session

```bash
npm run build-studio
```

Follow the interactive prompts:
- **Application name**: What you're building (e.g., "weather-app")
- **Description**: Brief description of your app
- **RAM limit**: How much RAM to allocate (e.g., 2048 for 2GB)
- **Max iterations**: How many build cycles (1-10, default: 5)
- **Preview mode**: CODE or UI
- **Test strictness**: strict or lenient

### Example Session

```bash
$ npm run build-studio

🏗️  Build Studio - Interactive Development System
═══════════════════════════════════════════════════

? Application name: weather-app
? Description: A weather forecast application with maps
? RAM limit (MB): 2048
? Max iterations (1-10): 5
? Preview mode (CODE/UI): CODE
? Test strictness (strict/lenient): lenient

✨ Created build session: session-abc123
📺 Preview available at: http://localhost:3500
🌐 Dashboard available at: http://localhost:3000/build-studio
```

## 📊 Dashboard Features

### Build Studio Dashboard
Access at: `http://localhost:3000/build-studio`

#### 1. **Session Overview**
- Current phase (PLANNING, BUILDING, TESTING, etc.)
- Progress through iterations
- Memory usage with visual bar
- Session controls (pause, resume, finish, cancel)

#### 2. **Artifacts Panel**
- Lists all build artifacts (files, components, etc.)
- File path, size, and last modified time
- **Interactive editor**: Click any artifact to edit its code
- Save changes that get incorporated in next iteration

#### 3. **Test Results**
- Real-time test execution results
- Pass/fail counts and percentages
- Individual test details with failure messages
- Performance metrics

#### 4. **Improvements**
- AI-suggested improvements from each iteration
- Prioritized by severity (critical, high, medium, low)
- Shows which suggestions were applied
- Tracks improvement over iterations

#### 5. **AI Chat Assistant**
- Ask questions about your build
- Request specific changes or features
- Get explanations of what's happening
- Guided optimization suggestions

#### 6. **Hardware Metrics**
- CPU usage by core
- Memory utilization
- Active worker threads
- System load and recommendations

## 🔧 Configuration Options

### Session Configuration

```typescript
interface SessionConfig {
  name: string;            // Application name
  description: string;     // What you're building
  ramLimitMB: number;     // Memory allocation (e.g., 2048)
  maxIterations: number;  // Build cycles (1-10)
  previewMode: 'CODE' | 'UI';
  testStrictness: 'strict' | 'lenient';
}
```

### Hardware Scaling

The system automatically:
- Detects CPU cores (e.g., 12 cores → 9 parallel workers)
- Measures available RAM
- Adjusts concurrency based on system load
- Scales up when resources available
- Scales down when under pressure

### Memory Profiles

| RAM Limit | Best For | Model Size |
|-----------|----------|------------|
| < 4GB | Small scripts, utilities | llama3.1:1b |
| 4-8GB | Medium apps, APIs | llama3.1:3b |
| 8-16GB | Full applications | llama3.1:8b |
| 16GB+ | Complex systems | llama3.1:70b |

## 🛠️ API Reference

### REST Endpoints

All endpoints are prefixed with `/api/build-studio`

#### Create Session
```
POST /start
Body: { name, description, ramLimitMB, maxIterations, previewMode, testStrictness }
Response: { sessionId, previewUrl, phase, ... }
```

#### Get Session Status
```
GET /status/:sessionId
Response: { session details, current phase, artifacts, tests, improvements }
```

#### Edit Artifact
```
POST /edit
Body: { sessionId, artifactId, newContent }
Response: { success, message }
```

#### Chat with AI
```
POST /chat
Body: { sessionId, message }
Response: { response }
```

#### Get Hardware Metrics
```
GET /hardware
Response: { cpuUsage, memoryUsage, workers, cores, recommendations }
```

#### Session Controls
```
POST /pause/:sessionId
POST /resume/:sessionId
POST /finish/:sessionId
POST /cancel/:sessionId
```

### WebSocket (Preview Server)

Connect to: `ws://localhost:3500`

#### Events from server:
- `phase-change`: Build phase transitions
- `artifact-created`: New file/component created
- `artifact-updated`: Code modified
- `test-complete`: Test execution results
- `improvement-found`: New suggestion
- `iteration-complete`: Full cycle finished
- `error`: Error occurred

#### Send to server:
```javascript
ws.send(JSON.stringify({
  type: 'subscribe',
  sessionId: 'session-abc123'
}));
```

## 🎨 Usage Examples

### CLI - Automated Build

```bash
# Start with all options
npm run build-studio -- \
  --name "blog-engine" \
  --description "Markdown blog with search" \
  --ram 4096 \
  --iterations 7 \
  --preview CODE \
  --strictness strict
```

### Programmatic Usage

```typescript
import { BuildStudioOrchestrator } from './orchestrator/BuildStudioOrchestrator';

const orchestrator = new BuildStudioOrchestrator(process.cwd());
await orchestrator.initialize();

const session = await orchestrator.startSession({
  name: 'my-app',
  description: 'A cool application',
  ramLimitMB: 2048,
  maxIterations: 5,
  previewMode: 'CODE',
  testStrictness: 'lenient'
});

// Session runs automatically
// Monitor via WebSocket or API
```

### Dashboard Integration

```typescript
// Connect to preview WebSocket
const ws = new WebSocket('ws://localhost:3500');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'phase-change':
      console.log(`Phase: ${data.phase}`);
      break;
    case 'artifact-created':
      console.log(`New file: ${data.artifact.path}`);
      break;
    case 'test-complete':
      console.log(`Tests: ${data.report.passed}/${data.report.totalTests}`);
      break;
  }
};

// Subscribe to session
ws.send(JSON.stringify({
  type: 'subscribe',
  sessionId: 'your-session-id'
}));
```

## 🔄 Build Lifecycle

### Phase Flow

```
IDLE
  ↓
PLANNING (Analyze requirements, create plan)
  ↓
BUILDING (Generate code, create artifacts)
  ↓
PREVIEWING (Launch preview, enable editing)
  ↓
TESTING (Run all tests, collect results)
  ↓
ANALYZING (Check for improvements)
  ↓
IMPROVING (Apply fixes and enhancements)
  ↓
AWAITING_FEEDBACK (Wait for user input)
  ↓
← Repeat until perfect or max iterations →
  ↓
PACKAGING (Bundle for deployment)
  ↓
COMPLETED (Ready to ship!)
```

### Iteration Example

**Iteration 1:**
- Creates initial app structure
- Generates basic functionality
- Runs tests → 60% pass rate
- AI suggests 12 improvements

**Iteration 2:**
- Applies top 8 improvements
- Refactors code based on test failures
- Runs tests → 85% pass rate
- AI suggests 5 more improvements

**Iteration 3:**
- Applies remaining improvements
- Optimizes performance
- Runs tests → 100% pass rate
- AI finds no critical issues → DONE

## 💡 Best Practices

### 1. **Start Conservative**
- Begin with lower RAM limits
- Use 3-5 iterations for first builds
- Try 'lenient' test strictness initially

### 2. **Use Live Editing**
- Preview artifacts as they're created
- Edit code directly in the dashboard
- Changes apply in next iteration

### 3. **Monitor Hardware**
- Check the Hardware tab for bottlenecks
- Reduce iterations if CPU/memory maxed
- Close other applications for better performance

### 4. **Leverage AI Chat**
- Ask for specific features: "Add error handling"
- Request explanations: "Why did test X fail?"
- Get optimization tips: "How can we make this faster?"

### 5. **Review Improvements**
- Check the Improvements panel each iteration
- High/Critical items are prioritized
- Can override via chat if needed

## 🐛 Troubleshooting

### Issue: Build runs out of memory
**Solution**: 
- Reduce RAM limit to give system more buffer
- Close other applications
- Reduce max iterations

### Issue: Tests keep failing
**Solution**:
- Switch to 'lenient' strictness
- Use AI chat to ask about specific failures
- Edit artifacts to fix issues manually

### Issue: Preview not updating
**Solution**:
- Check WebSocket connection at ws://localhost:3500
- Refresh dashboard
- Restart session if needed

### Issue: Build takes too long
**Solution**:
- Hardware may be bottlenecked
- Check Hardware tab for utilization
- Reduce parallel workers via `resourceManager.throttleIfNeeded()`

## 📦 Output

### Build Artifacts
Located in: `./output/<session-id>/`

```
output/
  session-abc123/
    src/
      index.ts
      components/
      utils/
    tests/
      *.test.ts
    package.json
    README.md
    build-manifest.json
```

### Session Data
Saved in: `./data/build-sessions/<session-id>.json`

Contains:
- Complete session configuration
- All artifacts with full content
- Test reports from each iteration
- Improvement history
- Performance metrics

## 🎯 Advanced Features

### Custom Build Agents

Create specialized agents for specific tasks:

```typescript
import { ImprovementAgent } from './agents/ImprovementAgent';

const securityAgent = new ImprovementAgent();
const suggestions = await securityAgent.analyzeCodeQuality(artifacts);
```

### Parallel Task Execution

```typescript
import { getHardwareScaler } from './utils/HardwareScaler';

const scaler = getHardwareScaler();

// Execute tasks in parallel
const results = await scaler.executeParallel([
  () => buildComponent('Header'),
  () => buildComponent('Footer'),
  () => buildComponent('Sidebar')
]);
```

### Resource Monitoring

```typescript
const metrics = await scaler.getUtilizationMetrics();
console.log(`CPU: ${metrics.cpuUsage}%`);
console.log(`Memory: ${metrics.memoryUsage}%`);
console.log(`Workers: ${metrics.availableWorkers}`);
```

## 🔐 Security

- Sessions are isolated by ID
- No external network access during builds
- Code execution in sandboxed environment
- All artifacts scanned for security issues

## 🚀 Performance Tips

1. **Hardware**: Use SSD for faster file I/O
2. **RAM**: Allocate 60-70% of available memory
3. **CPU**: More cores = faster parallel builds
4. **Iterations**: 3-5 is optimal for most projects
5. **Preview**: CODE mode is faster than UI mode

## 📝 Changelog

### v1.0.0 (Current)
- ✅ Full iterative build system
- ✅ RAM management and allocation
- ✅ Live preview with WebSocket
- ✅ Interactive code editing
- ✅ AI chat assistant
- ✅ Hardware auto-scaling
- ✅ Parallel task execution
- ✅ Continuous improvement engine
- ✅ Session persistence
- ✅ Comprehensive testing

---

## 🎉 You're Ready!

Build Studio is your tireless development partner. It will:
- ✅ Build your application iteratively
- ✅ Test everything thoroughly
- ✅ Find and fix issues automatically
- ✅ Optimize based on your hardware
- ✅ Give you live previews and editing
- ✅ Keep improving until perfect

**Start building:** `npm run build-studio`

**Need help?** Use the AI chat in the dashboard or check the troubleshooting section above.

Happy building! 🚀
