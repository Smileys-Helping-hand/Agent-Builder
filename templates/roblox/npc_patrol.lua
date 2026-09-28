local NPC = {}

function NPC.setup(character)
  local humanoid = character:FindFirstChildOfClass("Humanoid")
  if not humanoid then
    return
  end

  humanoid.DisplayName = "Patrol"

  local pathFolder = Instance.new("Folder")
  pathFolder.Name = "PatrolPoints"
  pathFolder.Parent = character

  for index = 1, 4 do
    local point = Instance.new("Part")
    point.Anchored = true
    point.Size = Vector3.new(1, 1, 1)
    point.CFrame = character:GetPivot() * CFrame.new(index * 10, 0, 0)
    point.Name = string.format("PatrolPoint%d", index)
    point.Parent = pathFolder
  end
end

return NPC
