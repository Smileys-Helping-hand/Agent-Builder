# 🏗️ Build Studio - Your Constant Building Partner

> Transform ideas into perfect applications through iterative AI-powered development

[![Tests](https://img.shields.io/badge/tests-6%2F6%20passing-brightgreen)]()
[![Hardware Optimized](https://img.shields.io/badge/hardware-optimized-blue)]()
[![Interactive](https://img.shields.io/badge/mode-interactive-orange)]()

## What is Build Studio?

Build Studio is an **iterative development system** built into Agent-Builder that acts as your constant building partner. It builds, tests, previews, and continuously improves your applications until they're perfect - all while respecting your hardware constraints.

## ✨ Key Features

🔄 **Iterative Building** - Continuously cycles through build → test → improve until perfect  
💾 **RAM Management** - Set your memory limit, system respects it  
📺 **Live Preview** - See builds happen in real-time via WebSocket  
✏️ **Interactive Editing** - Modify code during builds through dashboard  
🤖 **AI Assistant** - Built-in chat for guidance and modifications  
⚡ **Hardware Scaling** - Automatically optimizes for your CPU/RAM  
🧪 **Auto-Testing** - Generates and runs comprehensive tests  
📈 **Continuous Improvement** - AI finds and fixes issues each iteration  

## 🚀 Quick Start

```bash
# Start a new build session
npm run build-studio

# Test the system
npm run build-studio:test
```

Then open your browser:
- **Dashboard**: http://localhost:3000/build-studio
- **Preview**: http://localhost:3500

## 📖 Usage Example

```bash
$ npm run build-studio

🏗️  Build Studio - Interactive Development System

? Application name: weather-app
? Description: Weather forecast application with maps
? RAM limit (MB): 2048
? Max iterations (1-10): 5
? Preview mode (CODE/UI): CODE
? Test strictness (strict/lenient): lenient

✨ Created build session: session-abc123
📺 Preview available at: http://localhost:3500
🌐 Dashboard available at: http://localhost:3000/build-studio

[Build starts automatically...]

ITERATION 1/5: Planning → Building → Testing (8/12 pass) → Analyzing
ITERATION 2/5: Improving → Building → Testing (11/12 pass) → Analyzing
ITERATION 3/5: Improving → Building → Testing (12/12 pass) ✅
PACKAGING: Creating deployment bundle...
COMPLETED: Your app is ready in ./output/session-abc123/
```

## 🎯 How It Works

### Build Lifecycle

```
1. PLANNING     → Analyzes requirements, creates architecture
2. BUILDING     → Generates code (parallel execution)
3. PREVIEWING   → Broadcasts to dashboard via WebSocket
4. TESTING      → Runs all tests, collects results
5. ANALYZING    → AI checks for improvements (parallel)
6. IMPROVING    → Applies fixes and enhancements
7. FEEDBACK     → Wait for user input/edits
   ↓
   [Repeat until perfect or max iterations]
   ↓
8. PACKAGING    → Bundles for deployment
9. COMPLETED    → Ready to ship!
```

### Interactive Features

While building, you can:
- ✅ View artifacts as they're created
- ✅ Edit code directly in the dashboard
- ✅ Ask AI assistant questions
- ✅ Monitor hardware usage
- ✅ Pause/resume the session
- ✅ See test results in real-time

## 📊 Dashboard Overview

Access at `http://localhost:3000/build-studio`

### Tabs

1. **Overview**
   - Current phase & iteration
   - Memory usage bar
   - Session controls (pause/resume/finish/cancel)
   - Progress indicators

2. **Artifacts**
   - List of all build files
   - Click to edit code
   - Save changes for next iteration

3. **Tests**
   - Pass/fail results
   - Individual test details
   - Failure messages and fixes

4. **Improvements**
   - AI-suggested enhancements
   - Severity levels (critical → low)
   - Applied vs pending

5. **Chat**
   - Ask questions
   - Request features
   - Get explanations

6. **Hardware**
   - CPU usage
   - Memory utilization
   - Active workers
   - System recommendations

## ⚙️ Configuration

### Session Options

```typescript
{
  name: "my-app",              // What you're building
  description: "Description",  // Brief explanation
  ramLimitMB: 2048,           // Memory allocation (MB)
  maxIterations: 5,           // Build cycles (1-10)
  previewMode: "CODE",        // CODE or UI
  testStrictness: "lenient"   // strict or lenient
}
```

### RAM Recommendations

| System RAM | Suggested Limit | Use Case |
|-----------|----------------|----------|
| 8GB | 2048MB | Small utilities, scripts |
| 16GB | 4096MB | Medium apps, APIs |
| 32GB+ | 8192MB | Large applications |

## 🔧 API Reference

### REST Endpoints

All at `/api/build-studio`:

```bash
POST   /start                 # Create new session
GET    /status/:sessionId     # Get session info
POST   /edit                  # Modify artifact
POST   /chat                  # AI assistant
GET    /hardware              # System metrics
POST   /pause/:sessionId      # Pause build
POST   /resume/:sessionId     # Resume build
POST   /finish/:sessionId     # Complete early
POST   /cancel/:sessionId     # Cancel session
```

### WebSocket Events

Connect to `ws://localhost:3500`:

**Receive:**
- `phase-change` - Build phase transition
- `artifact-created` - New file created
- `artifact-updated` - File modified
- `test-complete` - Tests finished
- `improvement-found` - New suggestion
- `iteration-complete` - Cycle finished
- `error` - Error occurred

**Send:**
```javascript
ws.send(JSON.stringify({
  type: 'subscribe',
  sessionId: 'session-id'
}));
```

## 🎓 Advanced Usage

### Hardware Scaling

System automatically:
- Detects CPU cores (e.g., 12 cores → 9 optimal workers)
- Measures available RAM
- Executes tasks in parallel
- Scales workers based on load
- Optimizes for workload type (CPU/memory/IO)

Example on 12-core system:
- **Sequential build**: 10 tasks × 200ms = 2000ms
- **Parallel build**: 2 batches × 200ms = 400ms
- **Result**: **5x faster!** 🚀

### Programmatic Access

```typescript
import { BuildStudioOrchestrator } from './orchestrator/BuildStudioOrchestrator';

const orchestrator = new BuildStudioOrchestrator(process.cwd());
await orchestrator.initialize();

const session = await orchestrator.startSession({
  name: 'my-app',
  description: 'Cool application',
  ramLimitMB: 2048,
  maxIterations: 5,
  previewMode: 'CODE',
  testStrictness: 'lenient'
});

// Session runs automatically
// Monitor via WebSocket or API
```

## 📦 Output

After completion, find your app in:

```
./output/<session-id>/
  ├── src/
  │   ├── index.ts
  │   ├── components/
  │   └── utils/
  ├── tests/
  │   └── *.test.ts
  ├── package.json
  ├── README.md
  └── build-manifest.json
```

Session data saved in:
```
./data/build-sessions/<session-id>.json
```

## 🐛 Troubleshooting

### Build runs out of memory
- Reduce RAM limit to give system more buffer
- Close other applications
- Lower max iterations

### Tests keep failing
- Switch to 'lenient' strictness
- Use AI chat to diagnose failures
- Edit artifacts manually in dashboard

### Preview not updating
- Check WebSocket connection
- Refresh dashboard
- Restart session if needed

### Build is slow
- Check Hardware tab for bottlenecks
- Close resource-heavy applications
- System may be under load

## 📚 Documentation

- 📖 **[Complete Guide](docs/BUILD_STUDIO_GUIDE.md)** - Full documentation
- 🔍 **[Implementation Details](docs/BUILD_STUDIO_IMPLEMENTATION.md)** - Technical specs
- ⚡ **[Quick Reference](docs/BUILD_STUDIO_QUICKREF.md)** - Cheat sheet

## ✅ System Status

**All Tests Passing**: 6/6 ✅

```
✅ Hardware Detection
✅ Resource Manager
✅ Parallel Execution
✅ Build Studio Initialization
✅ Session Creation
✅ Auto-scaling
```

## 💡 Tips

- Start with 2GB RAM and 3-5 iterations for first builds
- Use CODE mode for faster preview
- Edit artifacts directly in the dashboard
- Ask AI chat specific questions
- Monitor Hardware tab for bottlenecks
- Let it run - it improves each iteration!

## 🎯 What Makes It Special

### Your Constant Building Partner

Build Studio isn't just a build tool - it's a partner that:
- ✅ **Never gives up** - Keeps improving until perfect
- ✅ **Learns from mistakes** - Analyzes failures and fixes them
- ✅ **Respects constraints** - Works within your RAM limits
- ✅ **Scales automatically** - Optimizes for your hardware
- ✅ **Stays interactive** - Edit and chat during builds
- ✅ **Thinks ahead** - Prioritizes critical fixes first

## 🚀 Get Started Now

```bash
npm run build-studio
```

Build something amazing! 🎉

---

**Version**: 1.0.0  
**Status**: Production Ready ✅  
**Tests**: All Passing ✅  
**Documentation**: Complete ✅
