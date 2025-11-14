local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local projectiles = Instance.new("Folder")
projectiles.Name = "Projectiles"
projectiles.Parent = workspace

local shootEvent = Instance.new("RemoteEvent")
shootEvent.Name = "Shoot"
shootEvent.Parent = ReplicatedStorage

local function createProjectile(origin, direction)
    local part = Instance.new("Part")
    part.Shape = Enum.PartType.Ball
    part.Material = Enum.Material.Neon
    part.Color = Color3.new(1, 0.2, 0.2)
    part.Size = Vector3.new(0.4, 0.4, 0.4)
    part.CFrame = CFrame.new(origin, origin + direction)
    part.Parent = projectiles
    part.CanCollide = false
    part.Anchored = false
    local velocity = Instance.new("BodyVelocity")
    velocity.MaxForce = Vector3.new(math.huge, math.huge, math.huge)
    velocity.Velocity = direction * 200
    velocity.Parent = part
    task.delay(2, function()
        part:Destroy()
    end)
end

shootEvent.OnServerEvent:Connect(function(player, origin, direction)
    createProjectile(origin, direction)
end)

Players.PlayerAdded:Connect(function(player)
    local leaderstats = Instance.new("Folder")
    leaderstats.Name = "leaderstats"
    leaderstats.Parent = player

    local eliminations = Instance.new("IntValue")
    eliminations.Name = "Eliminations"
    eliminations.Value = 0
    eliminations.Parent = leaderstats
end)
