local NPC = {}

function NPC.setup(character)
  local humanoid = character:FindFirstChildOfClass("Humanoid")
  if not humanoid then
    return
  end

  humanoid.DisplayName = "Shopkeeper"

  local dialogue = Instance.new("Dialog")
  dialogue.Purpose = Enum.DialogPurpose.Buy
  dialogue.InitialPrompt = "Looking for supplies?"
  dialogue.GoodbyeDialog = "Come back soon!"
  dialogue.Parent = character

  local info = Instance.new("Folder")
  info.Name = "ShopInventory"
  info.Parent = character

  local items = {
    { name = "Health Potion", price = 50 },
    { name = "Speed Boost", price = 75 }
  }

  for _, item in ipairs(items) do
    local value = Instance.new("StringValue")
    value.Name = item.name
    value.Value = tostring(item.price)
    value.Parent = info
  end
end

return NPC
