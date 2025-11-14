local HttpService = game:GetService("HttpService")
local StudioService = game:GetService("StudioService")
local Selection = game:GetService("Selection")

local PORT = 34872
local BRIDGE_FOLDER_NAME = "AgentBridge"

local DebugOverlay
pcall(function()
  local module = script:FindFirstChild("debug")
  if module then
    DebugOverlay = require(module)
  end
end)

local function ensureContainer()
local existing = workspace:FindFirstChild(BRIDGE_FOLDER_NAME)
if existing then
return existing
end
local folder = Instance.new("Folder")
folder.Name = BRIDGE_FOLDER_NAME
folder.Parent = workspace
return folder
end

local function sanitizeName(path)
local name = path:gsub("\\", "/")
name = name:match("([^/]+)$") or "AgentScript"
return name:gsub("[^%w_%-]", "_")
end

local function readSource(relativePath)
local ok, contents = pcall(function()
return readfile(relativePath)
end)
if not ok then
warn(string.format("[AgentBridge] Failed to read %s: %s", relativePath, contents))
return nil
end
return contents
end

local function applyScript(relativePath)
local source = readSource(relativePath)
if not source then
return
end

local container = ensureContainer()
local scriptName = sanitizeName(relativePath)
local target = container:FindFirstChild(scriptName)
if not target then
target = Instance.new("Script")
target.Name = scriptName
target.Parent = container
end

target.Source = source
print(string.format("[AgentBridge] Synced file %s", relativePath))
Selection:Set({ target })
end

local server
local ok, result = pcall(function()
return WebSocketServer.new(PORT)
end)

if ok then
server = result
else
warn(string.format("[AgentBridge] Unable to start WebSocket server on port %d: %s", PORT, tostring(result)))
return
end

print(string.format("[AgentBridge] Listening for Agent Builder on ws://localhost:%d", PORT))

server.OnMessage:Connect(function(message)
local success, payload = pcall(function()
return HttpService:JSONDecode(message)
end)
if not success then
warn("[AgentBridge] Invalid message payload", message)
return
end

local messageType = payload.type
if messageType == "sync" then
local path = payload.path
if type(path) == "string" then
applyScript(path)
else
warn("[AgentBridge] Missing file path in sync payload")
end
elseif messageType == "playtest" then
print("[AgentBridge] Received playtest request")
local okPlay, err = pcall(function()
StudioService:PlaySolo()
end)
if not okPlay then
warn("[AgentBridge] Failed to start PlaySolo", err)
end
elseif messageType == "debug_log" then
if DebugOverlay then
DebugOverlay.push(payload.message or "(no message)")
end
print(string.format("[AgentBridge] Debug log: %s", tostring(payload.message)))
elseif messageType == "debug_eval" then
local scriptSource = payload.script
if type(scriptSource) == "string" then
local okEval, err = pcall(function()
local fn = loadstring(scriptSource)
if fn then
fn()
end
end)
if not okEval then
warn("[AgentBridge] Debug eval failed", err)
end
else
warn("[AgentBridge] Missing script for debug_eval message")
end
else
warn(string.format("[AgentBridge] Unknown message type: %s", tostring(messageType)))
end
end)

server.OnClose:Connect(function()
print("[AgentBridge] Connection closed by Agent Builder")
end)
