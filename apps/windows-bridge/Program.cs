using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows.Automation;

namespace Patch.WindowsBridge;

internal static class Program
{
    private const string NativePipeName = "patch-browser-bridge-v1";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = false };

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (IsNativeMessagingLaunch(args))
            {
                await NativeMessaging.RunAsync(NativePipeName, CancellationToken.None);
                return 0;
            }

            await JsonLineRpc.RunAsync(CancellationToken.None);
            return 0;
        }
        catch (OperationCanceledException)
        {
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"PATCH Windows bridge fatal error: {exception.GetType().Name}: {exception.Message}");
            return 1;
        }
    }

    private static bool IsNativeMessagingLaunch(IReadOnlyList<string> args)
    {
        if (args.Any(arg => string.Equals(arg, "--native-host", StringComparison.OrdinalIgnoreCase))) return true;
        return args.Any(arg => arg.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase) ||
                               arg.StartsWith("extension://", StringComparison.OrdinalIgnoreCase));
    }

    internal static string Serialize(object value) => JsonSerializer.Serialize(value, JsonOptions);
}

internal static class JsonLineRpc
{
    public static async Task RunAsync(CancellationToken cancellationToken)
    {
        using var input = Console.OpenStandardInput();
        using var output = Console.OpenStandardOutput();
        using var reader = new StreamReader(input, new UTF8Encoding(false), detectEncodingFromByteOrderMarks: false, leaveOpen: true);
        using var writer = new StreamWriter(output, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };

        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(cancellationToken);
            if (line is null) break;
            if (string.IsNullOrWhiteSpace(line)) continue;

            RpcEnvelope response;
            try
            {
                var request = JsonSerializer.Deserialize<RpcRequest>(line, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? throw new InvalidDataException("Empty request.");
                var result = UiaService.Dispatch(request.Method, request.Params);
                response = RpcEnvelope.Success(request.RequestId, result);
            }
            catch (Exception exception)
            {
                var requestId = TryReadRequestId(line);
                response = RpcEnvelope.Failure(requestId, ErrorMapper.FromException(exception));
            }
            await writer.WriteLineAsync(Program.Serialize(response));
        }
    }

    private static string TryReadRequestId(string line)
    {
        try
        {
            using var document = JsonDocument.Parse(line);
            return document.RootElement.TryGetProperty("requestId", out var id) && id.ValueKind == JsonValueKind.String
                ? id.GetString() ?? "unknown"
                : "unknown";
        }
        catch
        {
            return "unknown";
        }
    }
}

internal static class NativeMessaging
{
    private const int MaxMessageBytes = 8 * 1024 * 1024;

    public static async Task RunAsync(string pipeName, CancellationToken cancellationToken)
    {
        await using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await pipe.ConnectAsync(10_000, cancellationToken);
        using var stdin = Console.OpenStandardInput();
        using var stdout = Console.OpenStandardOutput();
        using var pipeReader = new StreamReader(pipe, new UTF8Encoding(false), detectEncodingFromByteOrderMarks: false, leaveOpen: true);
        using var pipeWriter = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var chromeToDesktop = PumpChromeToDesktopAsync(stdin, pipeWriter, linked.Token);
        var desktopToChrome = PumpDesktopToChromeAsync(pipeReader, stdout, linked.Token);
        await Task.WhenAny(chromeToDesktop, desktopToChrome);
        linked.Cancel();
        try { await Task.WhenAll(chromeToDesktop, desktopToChrome); } catch (OperationCanceledException) { }
    }

    private static async Task PumpChromeToDesktopAsync(Stream chromeInput, StreamWriter pipeWriter, CancellationToken cancellationToken)
    {
        var lengthBuffer = new byte[4];
        while (!cancellationToken.IsCancellationRequested)
        {
            if (!await ReadExactAsync(chromeInput, lengthBuffer, cancellationToken)) break;
            var length = BitConverter.ToInt32(lengthBuffer, 0);
            if (length <= 0 || length > MaxMessageBytes) throw new InvalidDataException("Native messaging frame length is invalid.");
            var payload = new byte[length];
            if (!await ReadExactAsync(chromeInput, payload, cancellationToken)) throw new EndOfStreamException("Native messaging frame ended early.");
            var json = Encoding.UTF8.GetString(payload);
            await pipeWriter.WriteLineAsync(json.AsMemory(), cancellationToken);
        }
    }

    private static async Task PumpDesktopToChromeAsync(StreamReader pipeReader, Stream chromeOutput, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await pipeReader.ReadLineAsync(cancellationToken);
            if (line is null) break;
            var payload = Encoding.UTF8.GetBytes(line);
            if (payload.Length > MaxMessageBytes) throw new InvalidDataException("Desktop native messaging frame exceeds the size limit.");
            var length = BitConverter.GetBytes(payload.Length);
            await chromeOutput.WriteAsync(length, cancellationToken);
            await chromeOutput.WriteAsync(payload, cancellationToken);
            await chromeOutput.FlushAsync(cancellationToken);
        }
    }

    private static async Task<bool> ReadExactAsync(Stream stream, byte[] buffer, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset), cancellationToken);
            if (read == 0) return offset == 0 ? false : throw new EndOfStreamException();
            offset += read;
        }
        return true;
    }
}

internal sealed record RpcRequest(string RequestId, string Method, JsonElement Params);

internal sealed record RpcEnvelope(string RequestId, bool Ok, object? Result, BridgeError? Error)
{
    public static RpcEnvelope Success(string requestId, object? result) => new(requestId, true, result, null);
    public static RpcEnvelope Failure(string requestId, BridgeError error) => new(requestId, false, null, error);
}

internal sealed record BridgeError(string Code, string Message);

internal static class ErrorMapper
{
    public static BridgeError FromException(Exception exception) => exception switch
    {
        TargetNotFoundException => new("TARGET_NOT_FOUND", exception.Message),
        UnsupportedPatternException => new("TOOL_UNAVAILABLE", exception.Message),
        UnauthorizedAccessException => new("ACTION_DENIED", exception.Message),
        ElementNotAvailableException => new("TARGET_NOT_FOUND", "The UI element is no longer available. Refresh PATCH context and try again."),
        InvalidDataException or JsonException or ArgumentException => new("VALIDATION_FAILED", exception.Message),
        _ => new("ACTION_FAILED", exception.Message)
    };
}

internal sealed class TargetNotFoundException(string message) : Exception(message);
internal sealed class UnsupportedPatternException(string message) : Exception(message);

internal static class UiaService
{
    private const int DefaultMaxNodes = 1800;
    private const int DefaultMaxDepth = 12;

    public static object Dispatch(string method, JsonElement parameters) => method switch
    {
        "ping" => new { version = "1", platform = "windows", pid = Environment.ProcessId },
        "windows.getActiveWindow" => GetActiveWindow(),
        "windows.getAccessibilityTree" => GetAccessibilityTree(parameters),
        "windows.invoke" => Invoke(RequireTargetId(parameters)),
        "windows.toggle" => Toggle(RequireTargetId(parameters), RequireString(parameters, "state")),
        "windows.setValue" => SetValue(RequireTargetId(parameters), RequireString(parameters, "value")),
        "windows.select" => Select(RequireTargetId(parameters)),
        "windows.scroll" => Scroll(RequireTargetId(parameters), parameters),
        "screen.click" => Click(RequireDouble(parameters, "x"), RequireDouble(parameters, "y")),
        _ => throw new UnsupportedPatternException($"Unsupported Windows bridge method: {method}")
    };

    private static object GetActiveWindow()
    {
        var handle = Native.GetForegroundWindow();
        if (handle == IntPtr.Zero) throw new TargetNotFoundException("No active foreground window was found.");
        Native.GetWindowThreadProcessId(handle, out var processId);
        _ = Native.GetWindowRect(handle, out var rect);
        string? processName = null;
        string? executablePath = null;
        try
        {
            using var process = Process.GetProcessById(unchecked((int)processId));
            processName = process.ProcessName;
            try { executablePath = process.MainModule?.FileName; } catch (System.ComponentModel.Win32Exception) { }
        }
        catch (ArgumentException) { }

        var title = Native.GetWindowTextSafe(handle);
        return new
        {
            processName,
            windowTitle = string.IsNullOrWhiteSpace(title) ? null : title,
            executablePath,
            nativeWindowHandle = $"0x{handle.ToInt64():X}",
            bounds = new { x = rect.Left, y = rect.Top, width = Math.Max(0, rect.Right - rect.Left), height = Math.Max(0, rect.Bottom - rect.Top) }
        };
    }

    private static object GetAccessibilityTree(JsonElement parameters)
    {
        var maxNodes = ReadInt(parameters, "maxNodes", DefaultMaxNodes, 50, 5000);
        var maxDepth = ReadInt(parameters, "maxDepth", DefaultMaxDepth, 1, 24);
        var nativeWindowHandle = ReadString(parameters, "nativeWindowHandle");
        var root = string.IsNullOrWhiteSpace(nativeWindowHandle) ? GetForegroundRoot() : GetRootFromHandle(ParseWindowHandle(nativeWindowHandle));
        var count = 0;
        return new[] { BuildNode(root, 0, maxDepth, maxNodes, ref count) };
    }

    private static object Invoke(string id)
    {
        var element = Resolve(id);
        if (!element.TryGetCurrentPattern(InvokePattern.Pattern, out var patternObject))
            throw new UnsupportedPatternException("Target does not expose InvokePattern.");
        ((InvokePattern)patternObject).Invoke();
        return new { targetId = id, invoked = true, verified = false, verificationReason = "InvokePattern does not expose a general postcondition. PATCH will not claim an application-specific outcome without observing it." };
    }

    private static object Toggle(string id, string desired)
    {
        var desiredState = desired switch
        {
            "On" => ToggleState.On,
            "Off" => ToggleState.Off,
            _ => throw new InvalidDataException("Toggle state must be On or Off.")
        };
        var element = Resolve(id);
        if (!element.TryGetCurrentPattern(TogglePattern.Pattern, out var patternObject))
            throw new UnsupportedPatternException("Target does not expose TogglePattern.");
        var pattern = (TogglePattern)patternObject;
        var attempts = 0;
        while (pattern.Current.ToggleState != desiredState && attempts < 3)
        {
            pattern.Toggle();
            attempts++;
        }
        var actual = pattern.Current.ToggleState;
        return new { targetId = id, requested = desired, actual = actual.ToString(), verified = actual == desiredState };
    }

    private static object SetValue(string id, string value)
    {
        var element = Resolve(id);
        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out var patternObject))
            throw new UnsupportedPatternException("Target does not expose ValuePattern.");
        var pattern = (ValuePattern)patternObject;
        if (pattern.Current.IsReadOnly) throw new UnauthorizedAccessException("The requested control is read-only.");
        pattern.SetValue(value);
        var actual = pattern.Current.Value;
        return new { targetId = id, verified = string.Equals(actual, value, StringComparison.Ordinal), value = actual };
    }

    private static object Select(string id)
    {
        var element = Resolve(id);
        if (!element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var patternObject))
            throw new UnsupportedPatternException("Target does not expose SelectionItemPattern.");
        var pattern = (SelectionItemPattern)patternObject;
        pattern.Select();
        return new { targetId = id, verified = pattern.Current.IsSelected, selected = pattern.Current.IsSelected };
    }

    private static object Scroll(string id, JsonElement parameters)
    {
        var element = Resolve(id);
        if (!element.TryGetCurrentPattern(ScrollPattern.Pattern, out var patternObject))
            throw new UnsupportedPatternException("Target does not expose ScrollPattern.");
        var pattern = (ScrollPattern)patternObject;
        var horizontal = ParseScrollAmount(ReadString(parameters, "horizontal") ?? "NoAmount");
        var vertical = ParseScrollAmount(ReadString(parameters, "vertical") ?? "SmallIncrement");
        var beforeH = pattern.Current.HorizontalScrollPercent;
        var beforeV = pattern.Current.VerticalScrollPercent;
        pattern.Scroll(horizontal, vertical);
        var afterH = pattern.Current.HorizontalScrollPercent;
        var afterV = pattern.Current.VerticalScrollPercent;
        var requestedMovement = horizontal != ScrollAmount.NoAmount || vertical != ScrollAmount.NoAmount;
        var changed = beforeH != afterH || beforeV != afterV;
        var atBoundary = (vertical is ScrollAmount.LargeDecrement or ScrollAmount.SmallDecrement && afterV <= 0) ||
                         (vertical is ScrollAmount.LargeIncrement or ScrollAmount.SmallIncrement && afterV >= 100) ||
                         (horizontal is ScrollAmount.LargeDecrement or ScrollAmount.SmallDecrement && afterH <= 0) ||
                         (horizontal is ScrollAmount.LargeIncrement or ScrollAmount.SmallIncrement && afterH >= 100);
        return new { targetId = id, verified = !requestedMovement || changed || atBoundary, before = new { horizontal = beforeH, vertical = beforeV }, after = new { horizontal = afterH, vertical = afterV } };
    }

    private static object Click(double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) throw new InvalidDataException("Click coordinates must be finite numbers.");
        var left = Native.GetSystemMetrics(Native.SM_XVIRTUALSCREEN);
        var top = Native.GetSystemMetrics(Native.SM_YVIRTUALSCREEN);
        var width = Native.GetSystemMetrics(Native.SM_CXVIRTUALSCREEN);
        var height = Native.GetSystemMetrics(Native.SM_CYVIRTUALSCREEN);
        if (width <= 1 || height <= 1) throw new InvalidOperationException("Virtual screen metrics are unavailable.");
        if (x < left || x >= left + width || y < top || y >= top + height) throw new InvalidDataException("Click coordinates are outside the virtual desktop.");
        var normalizedX = (int)Math.Round((x - left) * 65535d / (width - 1));
        var normalizedY = (int)Math.Round((y - top) * 65535d / (height - 1));
        var inputs = new[]
        {
            Native.MouseInput(normalizedX, normalizedY, Native.MOUSEEVENTF_MOVE | Native.MOUSEEVENTF_ABSOLUTE | Native.MOUSEEVENTF_VIRTUALDESK),
            Native.MouseInput(0, 0, Native.MOUSEEVENTF_LEFTDOWN),
            Native.MouseInput(0, 0, Native.MOUSEEVENTF_LEFTUP)
        };
        if (Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Native.INPUT>()) != (uint)inputs.Length)
            throw new InvalidOperationException("Windows SendInput did not accept the complete click sequence.");
        return new { clicked = true, x, y, verified = false };
    }

    private static AutomationElement GetForegroundRoot()
    {
        var handle = Native.GetForegroundWindow();
        if (handle == IntPtr.Zero) throw new TargetNotFoundException("No active foreground window was found.");
        return GetRootFromHandle(handle);
    }

    private static AutomationElement GetRootFromHandle(IntPtr handle)
    {
        if (handle == IntPtr.Zero) throw new TargetNotFoundException("The requested window handle is invalid.");
        return AutomationElement.FromHandle(handle) ?? throw new TargetNotFoundException("The requested window does not expose a UI Automation root.");
    }

    private static IntPtr ParseWindowHandle(string value)
    {
        var trimmed = value.Trim();
        var parsed = trimmed.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
            ? Convert.ToInt64(trimmed[2..], 16)
            : long.Parse(trimmed, System.Globalization.CultureInfo.InvariantCulture);
        return new IntPtr(parsed);
    }

    private static AutomationElement Resolve(string id)
    {
        if (!id.StartsWith("uia-", StringComparison.Ordinal)) throw new InvalidDataException("UI Automation target ID must start with uia-.");
        var root = GetForegroundRoot();
        var walker = TreeWalker.ControlViewWalker;
        var stack = new Stack<AutomationElement>();
        stack.Push(root);
        var visited = 0;
        while (stack.Count > 0 && visited < 6000)
        {
            var current = stack.Pop();
            visited++;
            try
            {
                if (TargetId(current) == id) return current;
                var child = walker.GetFirstChild(current);
                while (child is not null)
                {
                    stack.Push(child);
                    child = walker.GetNextSibling(child);
                }
            }
            catch (ElementNotAvailableException) { }
        }
        throw new TargetNotFoundException($"UI Automation target {id} no longer exists in the active window.");
    }

    private static UiaNode BuildNode(AutomationElement element, int depth, int maxDepth, int maxNodes, ref int count)
    {
        count++;
        var current = element.Current;
        var isPassword = current.IsPassword;
        var bounds = current.BoundingRectangle;
        var node = new UiaNode(
            TargetId(element),
            Role(current.ControlType),
            isPassword ? "Password field" : SafeText(current.Name),
            current.IsEnabled,
            current.IsOffscreen,
            new Bounds(bounds.X, bounds.Y, Math.Max(0, bounds.Width), Math.Max(0, bounds.Height)),
            SupportedPatterns(element),
            isPassword ? null : ReadValue(element),
            []
        );
        if (depth >= maxDepth || count >= maxNodes) return node;

        var walker = TreeWalker.ControlViewWalker;
        try
        {
            var child = walker.GetFirstChild(element);
            while (child is not null && count < maxNodes)
            {
                try { node.Children.Add(BuildNode(child, depth + 1, maxDepth, maxNodes, ref count)); }
                catch (ElementNotAvailableException) { }
                child = walker.GetNextSibling(child);
            }
        }
        catch (ElementNotAvailableException) { }
        return node;
    }

    private static string TargetId(AutomationElement element)
    {
        var runtimeId = element.GetRuntimeId();
        var bytes = Encoding.UTF8.GetBytes(string.Join('.', runtimeId));
        var hash = SHA256.HashData(bytes);
        return $"uia-{Convert.ToHexString(hash.AsSpan(0, 8)).ToLowerInvariant()}";
    }

    private static string Role(ControlType type) => type.ProgrammaticName.Replace("ControlType.", string.Empty, StringComparison.Ordinal);
    private static string SafeText(string? value) => string.IsNullOrWhiteSpace(value) ? "" : value.Length <= 500 ? value : value[..500];

    private static string? ReadValue(AutomationElement element)
    {
        try
        {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var value)) return SafeText(((ValuePattern)value).Current.Value);
            if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out var range)) return ((RangeValuePattern)range).Current.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        catch (ElementNotAvailableException) { }
        return null;
    }

    private static List<string> SupportedPatterns(AutomationElement element)
    {
        var patterns = new List<string>(8);
        TryPattern(element, InvokePattern.Pattern, "Invoke", patterns);
        TryPattern(element, TogglePattern.Pattern, "Toggle", patterns);
        TryPattern(element, ValuePattern.Pattern, "Value", patterns);
        TryPattern(element, RangeValuePattern.Pattern, "RangeValue", patterns);
        TryPattern(element, SelectionItemPattern.Pattern, "SelectionItem", patterns);
        TryPattern(element, SelectionPattern.Pattern, "Selection", patterns);
        TryPattern(element, ScrollPattern.Pattern, "Scroll", patterns);
        TryPattern(element, ExpandCollapsePattern.Pattern, "ExpandCollapse", patterns);
        return patterns;
    }

    private static void TryPattern(AutomationElement element, AutomationPattern pattern, string name, ICollection<string> destination)
    {
        try { if (element.TryGetCurrentPattern(pattern, out _)) destination.Add(name); }
        catch (ElementNotAvailableException) { }
    }

    private static string RequireTargetId(JsonElement parameters) => RequireString(parameters, "targetId");
    private static string RequireString(JsonElement element, string property) => ReadString(element, property) ?? throw new InvalidDataException($"Missing required string: {property}");
    private static string? ReadString(JsonElement element, string property) => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static double RequireDouble(JsonElement element, string property) => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.TryGetDouble(out var number) ? number : throw new InvalidDataException($"Missing required number: {property}");
    private static int ReadInt(JsonElement element, string property, int fallback, int min, int max) => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.TryGetInt32(out var number) ? Math.Clamp(number, min, max) : fallback;
    private static ScrollAmount ParseScrollAmount(string value) => value switch
    {
        "NoAmount" => ScrollAmount.NoAmount,
        "LargeDecrement" => ScrollAmount.LargeDecrement,
        "SmallDecrement" => ScrollAmount.SmallDecrement,
        "SmallIncrement" => ScrollAmount.SmallIncrement,
        "LargeIncrement" => ScrollAmount.LargeIncrement,
        _ => throw new InvalidDataException("Invalid ScrollAmount.")
    };

    private sealed record Bounds(double X, double Y, double Width, double Height);
    private sealed record UiaNode(string Id, string Role, string Name, bool Enabled, bool Offscreen, Bounds Bounds, List<string> Patterns, string? Value, List<UiaNode> Children);
}

internal static class Native
{
    internal const int SM_XVIRTUALSCREEN = 76;
    internal const int SM_YVIRTUALSCREEN = 77;
    internal const int SM_CXVIRTUALSCREEN = 78;
    internal const int SM_CYVIRTUALSCREEN = 79;
    internal const uint MOUSEEVENTF_MOVE = 0x0001;
    internal const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    internal const uint MOUSEEVENTF_LEFTUP = 0x0004;
    internal const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    internal const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    internal static string GetWindowTextSafe(IntPtr hWnd)
    {
        var length = Math.Min(GetWindowTextLength(hWnd), 4096);
        if (length <= 0) return string.Empty;
        var builder = new StringBuilder(length + 1);
        _ = GetWindowText(hWnd, builder, builder.Capacity);
        return builder.ToString();
    }

    internal static INPUT MouseInput(int dx, int dy, uint flags) => new()
    {
        type = 0,
        U = new InputUnion { mi = new MOUSEINPUT { dx = dx, dy = dy, dwFlags = flags } }
    };

    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT { internal int Left; internal int Top; internal int Right; internal int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    internal struct INPUT { internal uint type; internal InputUnion U; }

    [StructLayout(LayoutKind.Explicit)]
    internal struct InputUnion
    {
        [FieldOffset(0)] internal MOUSEINPUT mi;
        [FieldOffset(0)] internal KEYBDINPUT ki;
        [FieldOffset(0)] internal HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MOUSEINPUT { internal int dx; internal int dy; internal uint mouseData; internal uint dwFlags; internal uint time; internal UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct KEYBDINPUT { internal ushort wVk; internal ushort wScan; internal uint dwFlags; internal uint time; internal UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct HARDWAREINPUT { internal uint uMsg; internal ushort wParamL; internal ushort wParamH; }
}
