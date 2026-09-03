# Build Studio - Quick Reference 🚀

## Start Building
```bash
npm run build-studio
```

## Test System
```bash
npm run build-studio:test
```

## Access Points

| Service | URL | Purpose |
|---------|-----|---------|
| Dashboard | http://localhost:3000/build-studio | Main UI |
| Preview | http://localhost:3500 | WebSocket updates |
| API | http://localhost:3000/api/build-studio | REST endpoints |

## Session Flow

```
npm run build-studio
→ Answer prompts (name, RAM, iterations)
→ Session starts automatically
→ Open dashboard to watch/edit
→ Build cycles until perfect or max iterations
→ Output in ./output/<session-id>/
```

## Key Features

✅ **Iterative Building** - Continuously improves
✅ **RAM Management** - Respects your limits
✅ **Live Preview** - See changes in real-time
✅ **Code Editing** - Modify artifacts on the fly
✅ **AI Chat** - Ask questions and get help
✅ **Hardware Scaling** - Optimizes for your system
✅ **Auto-Testing** - Generates and runs tests
✅ **Auto-Improvement** - Finds and fixes issues

## Dashboard Tabs

1. **Overview** - Session status, controls, memory
2. **Artifacts** - Files with code editor
3. **Tests** - Test results and failures
4. **Improvements** - AI suggestions
5. **Chat** - AI assistant
6. **Hardware** - System metrics

## Build Phases

```
IDLE → PLANNING → BUILDING → PREVIEWING → 
TESTING → ANALYZING → IMPROVING → AWAITING_FEEDBACK
→ [Loop] → PACKAGING → COMPLETED
```

## API Quick Reference

```bash
# Start session
POST /api/build-studio/start
{ name, description, ramLimitMB, maxIterations, previewMode, testStrictness }

# Get status
GET /api/build-studio/status/:sessionId

# Edit artifact
POST /api/build-studio/edit
{ sessionId, artifactId, newContent }

# Chat with AI
POST /api/build-studio/chat
{ sessionId, message }

# Hardware metrics
GET /api/build-studio/hardware

# Controls
POST /api/build-studio/pause/:sessionId
POST /api/build-studio/resume/:sessionId
POST /api/build-studio/finish/:sessionId
POST /api/build-studio/cancel/:sessionId
```

## Configuration Options

```typescript
{
  name: "my-app",              // Application name
  description: "Cool app",     // What you're building
  ramLimitMB: 2048,           // RAM allocation (MB)
  maxIterations: 5,           // Build cycles (1-10)
  previewMode: "CODE",        // CODE or UI
  testStrictness: "lenient"   // strict or lenient
}
```

## RAM Recommendations

| System RAM | Recommended Limit | Best For |
|-----------|------------------|----------|
| 8GB | 2048MB (2GB) | Small apps |
| 16GB | 4096MB (4GB) | Medium apps |
| 32GB+ | 8192MB (8GB) | Large apps |

## Troubleshooting

**Out of memory?**
- Lower RAM limit
- Close other apps
- Reduce iterations

**Tests failing?**
- Use 'lenient' strictness
- Edit artifacts manually
- Ask AI chat for help

**Slow performance?**
- Check Hardware tab
- Close resource-heavy apps
- Reduce parallel workers

## Tips

💡 Start with 2GB RAM and 3-5 iterations
💡 Use CODE mode for faster previews
💡 Edit artifacts directly in dashboard
💡 Ask AI chat specific questions
💡 Monitor Hardware tab for bottlenecks
💡 Let it run - it gets better each iteration!

## Example Session

```bash
$ npm run build-studio

? Application name: todo-app
? Description: Simple todo list with storage
? RAM limit (MB): 2048
? Max iterations: 5
? Preview mode: CODE
? Test strictness: lenient

✨ Created session: session-abc123
📺 Preview: http://localhost:3500
🌐 Dashboard: http://localhost:3000/build-studio

[System builds automatically...]

ITERATION 1: 8 files, 8/12 tests pass
ITERATION 2: Improvements applied, 11/12 tests pass
ITERATION 3: Final fixes, 12/12 tests pass ✅
COMPLETED: Ready in ./output/session-abc123/
```

## Files & Documentation

📄 **Full Guide**: `docs/BUILD_STUDIO_GUIDE.md`
📄 **Implementation**: `docs/BUILD_STUDIO_IMPLEMENTATION.md`
📄 **This Reference**: `docs/BUILD_STUDIO_QUICKREF.md`

## Support

- Check logs in console
- Use AI chat in dashboard
- Review improvements tab
- Check hardware metrics
- Inspect session JSON in `data/build-sessions/`

---

**Ready to build?** Just run: `npm run build-studio`

Your constant building partner awaits! 🎉
