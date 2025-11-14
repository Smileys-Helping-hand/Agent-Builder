local TerrainBuilder = {}

local function randomHeight(noise, x, z, amplitude)
  return noise(x, z) * amplitude
end

function TerrainBuilder.generate(seed)
  local terrain = workspace:FindFirstChildOfClass("Terrain")
  if not terrain then
    warn("TerrainBuilder: workspace has no Terrain object")
    return
  end

  math.randomseed(seed)
  local amplitude = 80
  local function noise(x, z)
    return math.noise(x / 128, 0, z / 128)
  end

  for x = -256, 256, 32 do
    for z = -256, 256, 32 do
      local height = randomHeight(noise, x, z, amplitude)
      local position = Vector3.new(x, height, z)
      terrain:FillBlock(CFrame.new(position), Vector3.new(32, 8, 32), Enum.Material.Grass)
    end
  end
end

return TerrainBuilder
