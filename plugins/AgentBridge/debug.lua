local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local DebugOverlay = {}
DebugOverlay._logs = {}
DebugOverlay._callbacks = {}

function DebugOverlay.push(message)
  table.insert(DebugOverlay._logs, 1, {
    text = message,
    timestamp = os.time()
  })
  if #DebugOverlay._logs > 20 then
    table.remove(DebugOverlay._logs)
  end
end

function DebugOverlay.onCommand(callback)
  table.insert(DebugOverlay._callbacks, callback)
end

local function renderGui()
  local playerGui = game.Players.LocalPlayer:WaitForChild("PlayerGui")
  local screen = playerGui:FindFirstChild("AgentOverlay")
  if not screen then
    screen = Instance.new("ScreenGui")
    screen.Name = "AgentOverlay"
    screen.ResetOnSpawn = false
    screen.Parent = playerGui
  end

  local frame = screen:FindFirstChild("LogFrame")
  if not frame then
    frame = Instance.new("Frame")
    frame.Name = "LogFrame"
    frame.BackgroundTransparency = 0.35
    frame.BackgroundColor3 = Color3.fromRGB(15, 23, 42)
    frame.BorderSizePixel = 0
    frame.Size = UDim2.new(0, 280, 0, 180)
    frame.Position = UDim2.fromOffset(20, 20)
    frame.Parent = screen

    local title = Instance.new("TextLabel")
    title.Name = "Title"
    title.BackgroundTransparency = 1
    title.Font = Enum.Font.GothamBold
    title.TextColor3 = Color3.fromRGB(125, 211, 252)
    title.TextSize = 16
    title.Text = "Agent Logs"
    title.Size = UDim2.new(1, -16, 0, 24)
    title.Position = UDim2.fromOffset(8, 8)
    title.Parent = frame

    local logs = Instance.new("TextLabel")
    logs.Name = "Body"
    logs.BackgroundTransparency = 1
    logs.Font = Enum.Font.Code
    logs.TextColor3 = Color3.fromRGB(226, 232, 240)
    logs.TextSize = 12
    logs.TextXAlignment = Enum.TextXAlignment.Left
    logs.TextYAlignment = Enum.TextYAlignment.Top
    logs.TextWrapped = true
    logs.Text = "Connecting..."
    logs.Size = UDim2.new(1, -16, 1, -56)
    logs.Position = UDim2.fromOffset(8, 40)
    logs.Parent = frame

    local input = Instance.new("TextBox")
    input.Name = "Command"
    input.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
    input.BorderSizePixel = 0
    input.TextColor3 = Color3.fromRGB(248, 250, 252)
    input.Font = Enum.Font.Code
    input.ClearTextOnFocus = false
    input.TextSize = 12
    input.PlaceholderText = "Type commands like 'Explain this NPC logic.'"
    input.Size = UDim2.new(1, -16, 0, 24)
    input.Position = UDim2.fromOffset(8, 140)
    input.Parent = frame

    input.FocusLost:Connect(function(enterPressed)
      if not enterPressed then
        return
      end

      local command = input.Text
      input.Text = ""

      for _, callback in ipairs(DebugOverlay._callbacks) do
        task.spawn(callback, command)
      end
    end)
  end

  local body = frame:FindFirstChild("Body")
  if body then
    local text = {}
    for _, log in ipairs(DebugOverlay._logs) do
      local formatted = string.format("[%s] %s", os.date("%H:%M:%S", log.timestamp), log.text)
      table.insert(text, formatted)
    end
    body.Text = table.concat(text, "\n")
  end
end

RunService.RenderStepped:Connect(renderGui)

return DebugOverlay
