using System.IO;
using System.Text.Json;

namespace BrainADZ.Events;

// Settings for this PC, kept in the user's roaming profile.
public sealed class Settings
{
    public string Server { get; set; } = "";
    // The Windows printer badges are sent to. Empty means the default printer.
    public string BadgePrinter { get; set; } = "";
    // The venue display this PC shows in display mode, e.g. /display/futureworks-expo/K1.
    public string DisplayPath { get; set; } = "";

    private static string Dir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BrainADZ Events");
    private static string FilePath => Path.Combine(Dir, "settings.json");

    public static Settings Load()
    {
        try
        {
            return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new Settings();
        }
        catch
        {
            return new Settings();
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(Dir);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
