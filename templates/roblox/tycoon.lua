local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local cashFolder = Instance.new("Folder")
cashFolder.Name = "CashValues"
cashFolder.Parent = workspace

local function createCashValue(player)
    local value = Instance.new("IntValue")
    value.Name = player.UserId .. "_Cash"
    value.Value = 0
    value.Parent = cashFolder
    return value
end

local function addCash(player, amount)
    local key = player.UserId .. "_Cash"
    local value = cashFolder:FindFirstChild(key) or createCashValue(player)
    value.Value += amount
end

local purchaseEvent = Instance.new("RemoteEvent")
purchaseEvent.Name = "PurchaseItem"
purchaseEvent.Parent = ReplicatedStorage

purchaseEvent.OnServerEvent:Connect(function(player, price)
    addCash(player, -price)
end)

Players.PlayerAdded:Connect(function(player)
    local leaderstats = Instance.new("Folder")
    leaderstats.Name = "leaderstats"
    leaderstats.Parent = player

    local cash = Instance.new("IntValue")
    cash.Name = "Cash"
    cash.Value = 0
    cash.Parent = leaderstats

    task.spawn(function()
        while player.Parent do
            task.wait(5)
            addCash(player, 25)
            cash.Value += 25
        end
    end)
end)
