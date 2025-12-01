-- Friendly lobby greeter who patrols and welcomes visitors warmly.
local NPC = {}

function NPC.setup(character)
  local humanoid = character:FindFirstChildOfClass("Humanoid")
  if not humanoid then
    return
  end

  humanoid.DisplayName = "Guide"

  local dialogue = Instance.new("Dialog")
  dialogue.InitialPrompt = "Welcome to the experience!"
  dialogue.Purpose = Enum.DialogPurpose.Quest
  dialogue.GoodbyeDialog = "See you on the adventure!"
  dialogue.Parent = character
end

return NPC

-- Behaviour prompt: Create a friendly greeter who patrols the lobby.
