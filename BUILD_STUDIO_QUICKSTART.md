# Build Studio - Quick Setup Guide

## 🎯 What You Just Built

Your Agent-Builder now has a **Build Studio** - an iterative development system that:
- Builds apps step-by-step with live preview
- Tests automatically and finds issues
- Suggests improvements and asks your approval
- Keeps iterating until you say "finished build"
- Works within your specified RAM limits

## 🚀 Quick Start

### 1. Start a Build Session

```bash
npm run build-studio:start
```

You'll be prompted:
```
What would you like to build? Build a todo app with React
RAM limit in MB (default 4096): 4096
```

### 2. Watch It Work

The system will:
- ✅ **Plan** the architecture
- ✅ **Build** components incrementally  
- ✅ **Preview** code in real-time (http://localhost:3500)
- ✅ **Test** everything automatically
- ✅ **Analyze** for improvements
- ✅ **Prompt** you to approve fixes

### 3. Interact

During the build:
```
Commands:
  finished build - Export production-ready app
  pause          - Pause the session
  status         - Show current progress
  help           - Show all commands
  exit           - Quit
```

### 4. Get Your Build

When ready:
```
> finished build
```

System creates optimized package in `dist/` folder!

## 📊 Dashboard

Open http://localhost:3000 to see:
- **Preview Tab**: Live code being generated
- **Tests Tab**: Pass/fail results
- **Improvements Tab**: AI suggestions to approve/reject
- **Timeline Tab**: Full history of what happened

## ⚙️ Configuration

Edit on-the-fly or via options:

```bash
build-studio start \
  --description "Express REST API" \
  --ram 6144 \
  --mode CODE \
  --strictness normal \
  --auto-approve
```

Options:
- `--ram`: Memory limit in MB (2048-16384)
- `--mode`: Preview mode (CODE|UI|ARCHITECTURE|HYBRID)
- `--strictness`: Testing level (lenient|normal|strict)
- `--auto-approve`: Auto-approve trivial fixes

## 📁 Files Created

```
src/
├── types/BuildStudio.ts              # Core type definitions
├── utils/ResourceManager.ts          # RAM monitoring
├── orchestrator/
│   ├── BuildSessionManager.ts        # Session management
│   └── BuildStudioOrchestrator.ts    # Main coordinator
├── preview/PreviewEngine.ts          # Live preview system
├── testing/TestOrchestrator.ts       # Automated testing
├── agents/ImprovementAgent.ts        # AI improvement analyzer
├── server/buildStudioRoutes.ts       # API endpoints
└── cli/buildStudio.ts                # CLI interface

dashboard/
├── components/BuildStudioPanel.tsx   # React dashboard
└── types/external.d.ts               # TypeScript types

docs/
└── BUILD_STUDIO.md                   # Full documentation

data/
└── build-sessions/                   # Saved sessions
```

## 🎓 Usage Examples

### Example 1: Quick Prototype
```bash
build-studio start --description "Weather app with OpenWeather API"
```

### Example 2: Production App
```bash
build-studio start \
  --description "E-commerce checkout system" \
  --ram 8192 \
  --strictness strict \
  --max-iterations 200
```

### Example 3: Resume Work
```bash
# List sessions
npm run build-studio:list

# Resume specific session
build-studio resume session-abc123
```

## 🔧 Troubleshooting

**Port 3500 already in use?**
```bash
# Kill process on port 3500
npx kill-port 3500
```

**Need more RAM?**
```bash
build-studio start --ram 8192
```

**Tests keep failing?**
```bash
# Use lenient mode while developing
build-studio start --strictness lenient
```

## 📚 Full Documentation

See [BUILD_STUDIO.md](./BUILD_STUDIO.md) for:
- Complete API reference
- Advanced configuration
- Event system
- Best practices
- Troubleshooting guide

## 🎉 That's It!

You now have a fully functional iterative build system. Just run:

```bash
npm run build-studio:start
```

And start building! The system will guide you through everything else.

---

**Questions?** Check the docs or dive into the code!
