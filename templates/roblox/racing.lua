local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local checkpointFolder = workspace:FindFirstChild("Checkpoints") or Instance.new("Folder", workspace)
checkpointFolder.Name = "Checkpoints"

local leaderboardEvent = Instance.new("RemoteEvent")
leaderboardEvent.Name = "RaceUpdate"
leaderboardEvent.Parent = ReplicatedStorage

local function setupLeaderboard(player)
    local leaderstats = Instance.new("Folder")
    leaderstats.Name = "leaderstats"
    leaderstats.Parent = player

    local lap = Instance.new("IntValue")
    lap.Name = "Lap"
    lap.Value = 1
    lap.Parent = leaderstats

    local checkpoint = Instance.new("IntValue")
    checkpoint.Name = "Checkpoint"
    checkpoint.Value = 0
    checkpoint.Parent = leaderstats
end

Players.PlayerAdded:Connect(function(player)
    setupLeaderboard(player)
end)

checkpointFolder.ChildAdded:Connect(function(child)
    if not child:IsA("BasePart") then
        return
    end

    child.Touched:Connect(function(hit)
        local player = Players:GetPlayerFromCharacter(hit.Parent)
        if not player then
            return
        end

        local lapValue = player.leaderstats:FindFirstChild("Lap")
        local checkpointValue = player.leaderstats:FindFirstChild("Checkpoint")
        if not lapValue or not checkpointValue then
            return
        end

        checkpointValue.Value += 1
        local children = checkpointFolder:GetChildren()
        local checkpointCount = #children
        if checkpointValue.Value >= checkpointCount then
            checkpointValue.Value = 0
            lapValue.Value += 1
        end

        leaderboardEvent:FireAllClients(player.UserId, lapValue.Value, checkpointValue.Value)
    end)
end)
