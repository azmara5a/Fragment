-- GUI Oluştur
local ScreenGui = Instance.new("ScreenGui")
local Frame = Instance.new("Frame")
local Title = Instance.new("TextLabel")
local ExecuteButton = Instance.new("TextButton")
local UIScale = Instance.new("UIScale")

-- GUI Ayarları
ScreenGui.Name = "FragmentGUI"
ScreenGui.Parent = game.Players.LocalPlayer:WaitForChild("PlayerGui")

Frame.Name = "Main"
Frame.Parent = ScreenGui
Frame.BackgroundColor3 = Color3.fromRGB(20, 20, 20)
Frame.Position = UDim2.new(0.05, 0, 0.5, -30)
Frame.Size = UDim2.new(0, 140, 0, 60)
Frame.BorderSizePixel = 0

UIScale.Parent = Frame
UIScale.Scale = 0.65

Title.Name = "Title"
Title.Parent = Frame
Title.BackgroundTransparency = 1
Title.Size = UDim2.new(1, 0, 0.5, 0)
Title.Text = "Fragment"
Title.TextColor3 = Color3.new(1, 1, 1)
Title.Font = Enum.Font.GothamBold
Title.TextScaled = t
ExecuteButton.Name = "Execute"
ExecuteButton.Parent = Frame
ExecuteButton.Position = UDim2.new(0.1, 0, 0.5, 0)
ExecuteButton.Size = UDim2.new(0.8, 0, 0.4, 0)
ExecuteButton.Text = "Başlat"
ExecuteButton.Font = Enum.Font.Gotham
ExecuteButton.TextColor3 = Color3.new(1, 1, 1)
ExecuteButton.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
ExecuteButton.BorderSizePixel = 0
ExecuteButton.TextScaled = true

-- İşlenecek meyveler (sadece izin verilenler!)
local allowedFruits = {
    ["Rocket"] = true, ["Spin"] = true, ["Chop"] = true, ["Spring"] = true,
    ["Eagle"] = true, ["Ice"] = true, ["Rubber"] = true, ["Light"] = true,
    -- Legendary ama SENİN izin verdiklerin:
    ["Quake"] = true, ["Love"] = true, ["Spider"] = true, ["Creation"] = true
}

-- Kütüphaneler
local Players = game:GetService("Players")
local LocalPlayer = Players.LocalPlayer
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RemoveFruit = ReplicatedStorage:WaitForChild("RemoveFruit")
local BuyChip = ReplicatedStorage:WaitForChild("BuyChip")
local StartIceRaid = ReplicatedStorage:WaitForChild("StartIceRaid")

-- Ana işlem fonksiyonu
local function processFruits()
    for _, fruit in ipairs(LocalPlayer.Backpack:GetChildren()) do
        if allowedFruits[fruit.Name] then
            RemoveFruit:FireServer(fruit.Name)
            task.wait(1)
            BuyChip:FireServer()
            task.wait(1)
            StartIceRaid:FireServer()
            task.wait(3)
        end
    end
end

-- Buton tıklama işlevi
ExecuteButton.MouseButton1Click:Connect(function()
    processFruits()
end)

-- GUI Aç / Kapa (RightShift)
local UserInputService = game:GetService("UserInputService")
UserInputService.InputBegan:Connect(function(input, gp)
    if not gp and input.KeyCode == Enum.KeyCode.RightShift then
        Frame.Visible = 
