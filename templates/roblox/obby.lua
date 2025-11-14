local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local checkpoints = {}

local function setupPlayer(player)
    local character = player.Character or player.CharacterAdded:Wait()
    local humanoidRoot = character:WaitForChild("HumanoidRootPart")

    humanoidRoot.CFrame = checkpoints[1].CFrame + Vector3.new(0, 4, 0)
end

local function recordCheckpoint(part)
    table.insert(checkpoints, part)
    part.Touched:Connect(function(hit)
        local player = Players:GetPlayerFromCharacter(hit.Parent)
        if not player then
            return
        end
        player:SetAttribute("checkpoint", #checkpoints)
    end)
end

workspace.Checkpoints.ChildAdded:Connect(function(child)
    if child:IsA("BasePart") then
        recordCheckpoint(child)
    end
end)

Players.PlayerAdded:Connect(function(player)
    player.CharacterAdded:Connect(function()
        setupPlayer(player)
    end)
    setupPlayer(player)
end)
