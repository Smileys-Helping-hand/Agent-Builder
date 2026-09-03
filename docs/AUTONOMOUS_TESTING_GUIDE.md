# Autonomous System Testing Guide

## Quick Start

The autonomous orchestration system is now fully integrated into Agent-Builder! Here's how to test it:

## Prerequisites

1. **Services Running**:
   ```powershell
   # API Server should be running on port 4000
   # Dashboard should be running on port 3000
   # Ollama should be running on port 11434
   ```

2. **Authentication**:
   - Login to the dashboard (default admin: mraaziqp@gmail.com / admin123)

## Testing the Autonomous System

### 1. Start the Backend (Terminal 1)

```powershell
cd C:\Users\mraaz\Agent-Builder
npm run dev
```

This starts the API server with the new autonomous routes on port 4000.

### 2. Start the Dashboard (Terminal 2)

```powershell
cd C:\Users\mraaz\Agent-Builder\dashboard
npm run dev
```

This starts the Next.js dashboard on port 3000.

### 3. Access the Autonomous Panel

1. Open browser: `http://localhost:3000`
2. Login with admin credentials
3. Click the **"Autonomous Build"** tab in the navigation

### 4. Test Basic Autonomous Build

**Test Case 1: Simple Application**

1. In the "Start New Autonomous Build" form:
   - Project Name: `Todo List App`
   - Description: `A simple todo list application with add, delete, and mark complete features`
   - Platforms: Check `windows`, `web`
   - Quality Threshold: `85%` (for faster testing)
   - Max Iterations: `20`

2. Click **"🚀 Start Autonomous Build"**

3. Observe:
   - Build ID is created
   - Status shows "🔄 Running"
   - Iteration counter increases
   - Quality score progresses toward threshold
   - Hardware status updates (CPU/Memory usage)

4. Test controls:
   - Click **"⏸️ Pause"** - Build should pause
   - Click **"▶️ Resume"** - Build should resume
   - Click **"⏹️ Stop"** - Build should stop completely

**Expected Behavior**:
- Should iterate 3-8 times before reaching 85% quality
- Each iteration takes 1-3 minutes (depending on hardware)
- Quality metrics should improve each iteration
- Should auto-stop when threshold reached

### 5. Test Hardware Optimization

**Test Case 2: Resource Monitoring**

1. Check the **"Hardware Status"** panel at the top
2. Verify displays:
   - ✅ CPU Usage percentage
   - ✅ Memory Usage percentage
   - ✅ Current Model (should match your RAM)
   - ✅ Optimal Tokens

3. If memory usage goes >85%, you should see:
   - ⚠️ Warning message recommending smaller model
   - System should auto-switch to smaller model

**Model Recommendations**:
- <8GB RAM: llama3.2:1b
- 8-16GB RAM: llama3.2:3b (your system)
- 16-32GB RAM: llama3.1:8b
- 32GB+ RAM: llama3.1:70b

### 6. Test Quality Analysis

**Test Case 3: Quality Metrics**

1. Start a new build:
   - Project Name: `E-Commerce Platform`
   - Description: `A full e-commerce platform with user authentication, product catalog, shopping cart, and payment processing`
   - Quality Threshold: `90%`
   - Max Iterations: `50`

2. Watch the **"Latest Metrics"** panel:
   - Completeness (should increase as features added)
   - Security (should improve as vulnerabilities fixed)
   - Performance (should optimize over iterations)
   - Usability (error handling improves)
   - Test Coverage (tests added in later iterations)

3. Check **"Iteration History"**:
   - Should show quality progression
   - Each iteration should be higher than previous
   - Status changes: running → analyzing → improving → packaging

**Expected Behavior**:
- More complex apps take 10-25 iterations
- Security and completeness are weighted highest
- Quality should never decrease between iterations

### 7. Test Multiple Concurrent Builds

**Test Case 4: Parallel Builds**

1. Start first build: `Simple Calculator App`
2. Start second build: `Weather Dashboard`
3. Check **"Active Builds"** section

Should show:
- Build count (2)
- List of both builds
- Individual status for each
- Click to switch between build details

**Expected Behavior**:
- Both builds run independently
- Can pause/resume/stop each separately
- Each tracks its own iterations and quality

### 8. Test API Endpoints Directly

**Using PowerShell/curl:**

```powershell
# Get active builds
$token = "your_jwt_token_here"
Invoke-RestMethod -Uri "http://localhost:4000/api/autonomous/active" -Headers @{Authorization="Bearer $token"}

# Start new build
$body = @{
  projectName = "Test App"
  description = "A test application"
  targetPlatforms = @("windows", "web")
  qualityThreshold = 85
  maxIterations = 20
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/autonomous/start" `
  -Method POST `
  -Headers @{Authorization="Bearer $token"; "Content-Type"="application/json"} `
  -Body $body

# Get build status (replace BUILD_ID)
Invoke-RestMethod -Uri "http://localhost:4000/api/autonomous/BUILD_ID/status" -Headers @{Authorization="Bearer $token"}

# Pause build
Invoke-RestMethod -Uri "http://localhost:4000/api/autonomous/BUILD_ID/pause" -Method POST -Headers @{Authorization="Bearer $token"}

# Resume build
Invoke-RestMethod -Uri "http://localhost:4000/api/autonomous/BUILD_ID/resume" -Method POST -Headers @{Authorization="Bearer $token"}

# Stop build
Invoke-RestMethod -Uri "http://localhost:4000/api/autonomous/BUILD_ID/stop" -Method POST -Headers @{Authorization="Bearer $token"}

# Get hardware info
Invoke-RestMethod -Uri "http://localhost:4000/api/autonomous/hardware" -Headers @{Authorization="Bearer $token"}
```

### 9. Verify Packaging

**Test Case 5: Multi-Platform Packaging**

1. Start build with all platforms checked:
   - ✅ windows
   - ✅ macos
   - ✅ linux
   - ✅ web

2. Let it complete (reach quality threshold)

3. Check output directory:
   ```powershell
   ls C:\Users\mraaz\Agent-Builder\builds\*\packages
   ```

4. Should contain:
   - `windows/app-name.exe` (or portable package)
   - `macos/AppName.app` (or portable)
   - `linux/app-name` (or portable)
   - `web/` (static site files)

**Note**: pkg tool must be installed for native executables:
```powershell
npm install -g pkg
```

### 10. Monitor Logs

**Real-time Monitoring:**

```powershell
# Terminal 3: Watch API logs
cd C:\Users\mraaz\Agent-Builder
npm run dev

# Look for:
# - "Autonomous build started" with buildId
# - "Iteration complete" with quality scores
# - "Quality threshold met" when done
# - Hardware optimization messages
```

## Common Issues & Solutions

### Issue 1: Build Stuck at Low Quality

**Symptoms**: Quality score stays at 40-60% and doesn't improve

**Solution**:
1. Check iteration history - if status is "error", there's a problem
2. Lower quality threshold to 75%
3. Check Ollama is responding: `curl http://localhost:11434/api/tags`
4. Restart build with simpler description

### Issue 2: High Memory Usage

**Symptoms**: Memory >90%, system slows down

**Solution**:
1. HardwareScaler should auto-switch to smaller model
2. Manually set: `OLLAMA_MODEL=llama3.2:1b` in .env
3. Reduce concurrent builds
4. Increase adaptive delays

### Issue 3: Iterations Taking Too Long

**Symptoms**: Each iteration takes >5 minutes

**Solution**:
1. Check hardware status panel for bottlenecks
2. Ensure Ollama is running locally (not remote)
3. Use smaller model for faster iterations
4. Reduce max token limits in HardwareScaler

### Issue 4: Authentication Errors

**Symptoms**: 401/403 errors in API calls

**Solution**:
1. Login to dashboard first
2. Token stored in localStorage
3. Check token: `localStorage.getItem('token')` in browser console
4. Re-login if token expired

## Performance Benchmarks

### Expected Iteration Times (on your system: 8GB RAM, llama3.2:3b)

- **Simple App** (Todo, Calculator): 30-90 seconds/iteration
- **Medium App** (Dashboard, Blog): 2-4 minutes/iteration
- **Complex App** (E-commerce, Game): 4-8 minutes/iteration

### Expected Quality Progression

```
Iteration 1:  40-50% (basic structure)
Iteration 3:  55-65% (core features)
Iteration 5:  65-75% (tests added)
Iteration 8:  75-85% (security fixes)
Iteration 10: 85-95% (production-ready)
```

## Success Criteria

✅ **System is working correctly if**:

1. Builds start successfully and get unique build IDs
2. Iterations run automatically without stopping
3. Quality scores increase with each iteration
4. Hardware monitoring shows real CPU/memory data
5. Pause/resume/stop controls work immediately
6. Multiple builds can run concurrently
7. System auto-stops when threshold reached
8. Packaging creates platform-specific outputs

## Next Steps

Once basic testing is complete:

1. **Test Edge Cases**:
   - Very simple requests (quality reaches 100%)
   - Very complex requests (may hit max iterations)
   - Invalid inputs (error handling)

2. **Performance Testing**:
   - Run 3-5 concurrent builds
   - Monitor system resources
   - Test on different hardware configs

3. **Integration Testing**:
   - Test with real Unity game requests
   - Test with production app requirements
   - Verify packaged apps actually run

4. **User Experience**:
   - Time how long until production-ready app
   - Test with non-technical users
   - Gather feedback on UI/UX

## Debugging Tips

1. **Check Browser Console** (F12):
   - Look for API errors
   - Check network tab for failed requests
   - Verify WebSocket connections

2. **Check API Server Logs**:
   - Should see "Autonomous build started"
   - Should see iteration updates
   - Look for error messages

3. **Check Ollama**:
   ```powershell
   curl http://localhost:11434/api/tags
   # Should return list of models including llama3.2:3b
   ```

4. **Check Process Status**:
   ```powershell
   Get-Process | Where-Object {$_.ProcessName -like "*node*" -or $_.ProcessName -like "*ollama*"}
   # Should see multiple node processes and ollama
   ```

## Conclusion

The autonomous orchestration system is fully functional and ready for testing! Start with the simple test cases and gradually move to more complex scenarios.

**Key Features to Validate**:
- ✅ Continuous iteration (doesn't stop after one attempt)
- ✅ Quality-driven stopping (reaches threshold)
- ✅ Hardware optimization (adapts to system)
- ✅ Multi-platform packaging (produces installers)
- ✅ Real-time monitoring (live updates in UI)
- ✅ User control (pause/resume/stop)

**Report any issues found during testing!**
