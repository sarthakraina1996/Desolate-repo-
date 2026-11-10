// BrainADZ Events for Windows: the organiser console, exhibitor workspace, gate scanner and
// venue displays in a native window. What the native shell adds over a browser:
//   - badges print silently to the badge printer chosen for this PC (print station);
//   - display mode runs a venue display full screen and keeps retrying if the network drops;
//   - the camera works for scanning without a browser permission prompt;
//   - the sign-in stays on this PC between restarts.
using System.Diagnostics;
using System.IO;
using System.Printing;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace BrainADZ.Events;

public partial class MainWindow : Window
{
    private readonly Settings _settings = Settings.Load();
    private readonly DispatcherTimer _retry = new() { Interval = TimeSpan.FromSeconds(15) };
    private bool _kiosk;
    private WindowState _stateBeforeKiosk;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await StartAsync();
        PreviewKeyDown += OnKey;
        // In display mode a failed page is retried on its own; nobody is at the keyboard.
        _retry.Tick += (_, _) => { if (OfflinePanel.Visibility == Visibility.Visible) Web.Reload(); };
    }

    private async Task StartAsync()
    {
        // The browser profile (cookies, cached pages) lives in the user's local app data.
        var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BrainADZ Events", "WebView");
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, data);
            await Web.EnsureCoreWebView2Async(env);
        }
        catch (Exception e)
        {
            MessageBox.Show(this, "BrainADZ Events needs the Microsoft Edge WebView2 Runtime, which is part of Windows 11 and current Windows 10.\n\n" +
                "Install it from microsoft.com/edge/webview2, then start the app again.\n\n" + e.Message, "BrainADZ Events", MessageBoxButton.OK, MessageBoxImage.Warning);
            Close();
            return;
        }
        var core = Web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.WebMessageReceived += OnWebMessage;
        core.NavigationCompleted += OnNavigated;
        core.NavigationStarting += OnNavigating;
        core.NewWindowRequested += OnNewWindow;
        core.PermissionRequested += OnPermission;
        core.HistoryChanged += (_, _) => BackButton.IsEnabled = core.CanGoBack;
        core.DocumentTitleChanged += (_, _) => Title = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "BrainADZ Events" : core.DocumentTitle;
        UpdatePrinterLabel();

        // "--display [path]" starts straight into display mode, for kiosks and wall screens.
        var args = Environment.GetCommandLineArgs();
        var display = Array.IndexOf(args, "--display");
        if (display >= 0)
        {
            if (display + 1 < args.Length) _settings.DisplayPath = args[display + 1];
            if (HasServer() && _settings.DisplayPath != "") { EnterKiosk(); return; }
        }
        if (!HasServer() && !EditSettings()) { Close(); return; }
        Go("/signin");
    }

    private bool HasServer() => Uri.TryCreate(_settings.Server, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http");
    private void Go(string path) => Web.CoreWebView2?.Navigate(_settings.Server.TrimEnd('/') + path);
    private bool IsOurs(string url) => HasServer() && Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Host == new Uri(_settings.Server).Host;

    // ---------- navigation ----------
    private void OnNavigating(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        // Links to other sites (exhibitor websites, catalogues) open in the default browser.
        if (!IsOurs(e.Uri) && e.Uri.StartsWith("http", StringComparison.OrdinalIgnoreCase))
        {
            e.Cancel = true;
            Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
        }
    }

    private void OnNewWindow(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (IsOurs(e.Uri)) Web.CoreWebView2.Navigate(e.Uri);
        else Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
    }

    private void OnNavigated(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        // An HTTP error page from the server still counts as reachable; only connection
        // failures show the offline panel.
        var failed = !e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled && e.HttpStatusCode == 0;
        OfflinePanel.Visibility = failed ? Visibility.Visible : Visibility.Collapsed;
        OfflineSettings.Visibility = _kiosk ? Visibility.Collapsed : Visibility.Visible;
        if (failed)
            OfflineText.Text = $"{_settings.Server} did not answer. Check this PC's network connection, or that the event server is running." +
                (_kiosk ? " Trying again every 15 seconds." : "");
    }

    // The camera is allowed for the event server only, so the scanner starts without a prompt.
    private void OnPermission(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        if (e.PermissionKind == CoreWebView2PermissionKind.Camera)
            e.State = IsOurs(e.Uri) ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
    }

    private void Back_Click(object sender, RoutedEventArgs e) { if (Web.CoreWebView2?.CanGoBack == true) Web.CoreWebView2.GoBack(); }
    private void Reload_Click(object sender, RoutedEventArgs e) => Web.CoreWebView2?.Reload();
    private void Home_Click(object sender, RoutedEventArgs e) => Go("/signin");
    private void Gate_Click(object sender, RoutedEventArgs e) => Go("/gate");
    private void Settings_Click(object sender, RoutedEventArgs e) { if (EditSettings()) Go("/signin"); }

    private void OnKey(object sender, KeyEventArgs e)
    {
        var mods = Keyboard.Modifiers;
        if (e.Key == Key.F5) { Web.CoreWebView2?.Reload(); e.Handled = true; }
        else if (e.Key == Key.F11) { if (_kiosk) LeaveKiosk(); else if (_settings.DisplayPath != "") EnterKiosk(); e.Handled = true; }
        // Display mode has no visible controls; this is the way out for staff.
        else if (_kiosk && e.Key == Key.Q && mods == (ModifierKeys.Control | ModifierKeys.Shift)) { LeaveKiosk(); e.Handled = true; }
        else if (e.SystemKey == Key.Left && mods == ModifierKeys.Alt && !_kiosk) { Back_Click(sender, e); e.Handled = true; }
    }

    // ---------- badge printing ----------
    // The web scanner posts {type:"printBadge"} when its badge sheet is ready. The page is
    // printed to the badge printer without a dialog and the result is posted back.
    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsOurs(e.Source)) return;
        string? type;
        try { type = JsonDocument.Parse(e.WebMessageAsJson).RootElement.GetProperty("type").GetString(); }
        catch { return; }
        if (type != "printBadge") return;

        string? error = null;
        try
        {
            var print = Web.CoreWebView2.Environment.CreatePrintSettings();
            print.ShouldPrintBackgrounds = true;
            print.ShouldPrintHeaderAndFooter = false;
            print.MarginTop = print.MarginBottom = print.MarginLeft = print.MarginRight = 0;
            if (_settings.BadgePrinter != "") print.PrinterName = _settings.BadgePrinter;
            var status = await Web.CoreWebView2.PrintAsync(print);
            if (status != CoreWebView2PrintStatus.Succeeded)
                error = status == CoreWebView2PrintStatus.PrinterUnavailable ? "Printer is offline or out of paper" : "The printer reported an error";
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }
        Web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "printResult", ok = error == null, error }));
    }

    private void UpdatePrinterLabel() =>
        PrinterLabel.Text = _settings.BadgePrinter == "" ? "Badge printer: Windows default" : $"Badge printer: {_settings.BadgePrinter}";

    // ---------- display mode ----------
    private void Display_Click(object sender, RoutedEventArgs e)
    {
        var path = Prompt("Display mode", "Venue display to show on this PC. Copy it from Settings › Venue › Venue displays in the organiser console.\n\nPress Ctrl+Shift+Q or F11 to leave display mode.",
            _settings.DisplayPath == "" ? "/display/your-event/K1" : _settings.DisplayPath);
        if (path == null) return;
        // A full link pasted from the browser is reduced to its path on this server.
        if (Uri.TryCreate(path, UriKind.Absolute, out var u)) path = u.PathAndQuery;
        if (!path.StartsWith("/display/")) { MessageBox.Show(this, "A display address starts with /display/", "Display mode"); return; }
        _settings.DisplayPath = path;
        _settings.Save();
        EnterKiosk();
    }

    private void EnterKiosk()
    {
        _kiosk = true;
        _stateBeforeKiosk = WindowState;
        Toolbar.Visibility = Visibility.Collapsed;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        WindowState = WindowState.Normal;   // so the next line takes the whole screen, taskbar included
        WindowState = WindowState.Maximized;
        Topmost = true;
        Web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _retry.Start();
        Go(_settings.DisplayPath);
    }

    private void LeaveKiosk()
    {
        _kiosk = false;
        _retry.Stop();
        Topmost = false;
        WindowStyle = WindowStyle.SingleBorderWindow;
        ResizeMode = ResizeMode.CanResize;
        WindowState = _stateBeforeKiosk;
        Toolbar.Visibility = Visibility.Visible;
        Web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        Go("/signin");
    }

    // ---------- settings ----------
    // Server address and badge printer. Returns false when cancelled.
    private bool EditSettings()
    {
        var server = new TextBox { Text = _settings.Server == "" ? "https://" : _settings.Server, Padding = new Thickness(8, 6, 8, 6), Margin = new Thickness(0, 4, 0, 12) };
        var printers = new ComboBox { Padding = new Thickness(8, 6, 8, 6), Margin = new Thickness(0, 4, 0, 4) };
        printers.Items.Add("Windows default printer");
        try
        {
            using var local = new LocalPrintServer();
            foreach (var q in local.GetPrintQueues(new[] { EnumeratedPrintQueueTypes.Local, EnumeratedPrintQueueTypes.Connections })) printers.Items.Add(q.FullName);
        }
        catch
        {
            // No print spooler: the list just stays at the default printer.
        }
        printers.SelectedItem = _settings.BadgePrinter == "" || !printers.Items.Contains(_settings.BadgePrinter) ? printers.Items[0] : _settings.BadgePrinter;

        var panel = new StackPanel { Margin = new Thickness(20) };
        panel.Children.Add(new TextBlock { Text = "Event server address", FontWeight = FontWeights.SemiBold });
        panel.Children.Add(new TextBlock { Text = "The address your organiser gave you, or the venue server shown in its start window, for example http://192.168.1.20:3100", Foreground = (Brush)FindResource("Ink2"), TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(server);
        panel.Children.Add(new TextBlock { Text = "Badge printer", FontWeight = FontWeights.SemiBold });
        panel.Children.Add(new TextBlock { Text = "Badges from the gate scanner print here without a dialog.", Foreground = (Brush)FindResource("Ink2"), TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(printers);
        var dialog = Dialog("Settings", panel, "Save");
        while (dialog.ShowDialog() == true)
        {
            if (Uri.TryCreate(server.Text.Trim(), UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "")
            {
                _settings.Server = server.Text.Trim().TrimEnd('/');
                _settings.BadgePrinter = printers.SelectedIndex <= 0 ? "" : (string)printers.SelectedItem;
                _settings.Save();
                UpdatePrinterLabel();
                return true;
            }
            MessageBox.Show(this, "Enter the full address, starting with https:// or http://", "Settings");
            dialog = Dialog("Settings", panel, "Save");
        }
        return false;
    }

    private string? Prompt(string title, string message, string value)
    {
        var box = new TextBox { Text = value, Padding = new Thickness(8, 6, 8, 6), Margin = new Thickness(0, 8, 0, 4) };
        var panel = new StackPanel { Margin = new Thickness(20) };
        panel.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(box);
        return Dialog(title, panel, "Start").ShowDialog() == true ? box.Text.Trim() : null;
    }

    // A small modal window with the content, a primary button and Cancel.
    private Window Dialog(string title, StackPanel content, string okText)
    {
        // The content may be shown again after a validation message; detach it from the old window.
        if (content.Parent is ContentControl old) old.Content = null;
        var window = new Window
        {
            Title = title, Owner = this, Width = 480, SizeToContent = SizeToContent.Height, ResizeMode = ResizeMode.NoResize,
            WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = (Brush)FindResource("Canvas"), ShowInTaskbar = false,
        };
        var ok = new Button { Content = okText, IsDefault = true, MinWidth = 96, MinHeight = 36, Margin = new Thickness(0, 0, 8, 0), Style = (Style)FindResource("Primary") };
        var cancel = new Button { Content = "Cancel", IsCancel = true, MinWidth = 96, MinHeight = 36 };
        ok.Click += (_, _) => window.DialogResult = true;
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(20, 0, 20, 20) };
        buttons.Children.Add(ok);
        buttons.Children.Add(cancel);
        var root = new StackPanel();
        root.Children.Add(new ContentControl { Content = content, IsTabStop = false });
        root.Children.Add(buttons);
        window.Content = root;
        return window;
    }
}
