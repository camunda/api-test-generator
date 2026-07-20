using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using Camunda.Orchestration.Sdk;
using Xunit;

namespace CamundaIntegrationTests;

public abstract class TestFixtureBase
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    protected CamundaClient Client { get; }

    protected TestFixtureBase()
    {
        Client = CamundaClient.Create();
    }

    protected static void SeedBindingIfMissing(
        Dictionary<string, object?> ctx,
        string binding,
        string seedRule
    )
    {
        if (!ctx.TryGetValue(binding, out var value) || value == null)
        {
            ctx[binding] = SeedBinding(seedRule);
        }
    }

    protected static string SeedBinding(string varName)
    {
        return SeedEnv.Instance.Generate(varName);
    }

    /// <summary>
    /// Read a required binding from the test context. Unlike the raw indexer
    /// (<c>ctx[binding]</c>), a missing or null binding surfaces a clear,
    /// deterministic <see cref="InvalidOperationException"/> naming the binding
    /// instead of a bare <see cref="KeyNotFoundException"/> thrown from deep in
    /// the request-building code.
    /// </summary>
    protected static object RequireBinding(Dictionary<string, object?> ctx, string binding)
    {
        if (!ctx.TryGetValue(binding, out var value) || value is null)
        {
            throw new InvalidOperationException(
                $"Required binding '{binding}' was not present in the test context. " +
                "Ensure the producing step seeded it before this request.");
        }

        return value;
    }

    protected static T BuildRequest<T>(Dictionary<string, object?> data) where T : class, new()
    {
        var json = JsonSerializer.Serialize(data, JsonOptions);
        return JsonSerializer.Deserialize<T>(json, JsonOptions) ?? new T();
    }

    protected static int GetStatusCode(object? response)
    {
        if (response == null)
        {
            throw new InvalidOperationException("Response is null; cannot read status code.");
        }
        if (response is CamundaSdkException sdkEx && sdkEx.Status.HasValue)
        {
            return sdkEx.Status.Value;
        }
        var type = response.GetType();
        var prop = type.GetProperty("StatusCode") ?? type.GetProperty("Status");
        if (prop != null)
        {
            var raw = prop.GetValue(response);
            if (raw is int i) return i;
            if (raw is long l) return (int)l;
            if (raw is Enum e) return Convert.ToInt32(e, CultureInfo.InvariantCulture);
        }
        throw new InvalidOperationException($"Could not read StatusCode from {type.Name}.");
    }

    protected static void AssertExpectedStatus(object? response, int expectedStatus)
    {
        try
        {
            var actual = GetStatusCode(response);
            Assert.Equal(expectedStatus, actual);
        }
        catch (InvalidOperationException)
        {
            Assert.InRange(expectedStatus, 200, 299);
        }
    }

    protected static bool IsDefaultSentinel(Dictionary<string, object?> ctx, string binding, string sentinel)
    {
        if (!ctx.TryGetValue(binding, out var value) || value == null) return false;
        return string.Equals(Convert.ToString(value, CultureInfo.InvariantCulture), sentinel, StringComparison.Ordinal);
    }

    protected static JsonElement ToJsonElement(object? response)
    {
        if (response is JsonElement elem)
        {
            return elem.Clone();
        }
        var json = JsonSerializer.Serialize(response, JsonOptions);
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    protected static MultipartFormDataContent BuildMultipart(
        Dictionary<string, object?> fields,
        Dictionary<string, object?> files)
    {
        var content = new MultipartFormDataContent();

        foreach (var field in fields)
        {
            if (field.Value == null) continue;
            var value = Convert.ToString(field.Value, CultureInfo.InvariantCulture) ?? string.Empty;
            content.Add(new StringContent(value), field.Key);
        }

        foreach (var file in files)
        {
            if (file.Value == null) continue;
            var raw = Convert.ToString(file.Value, CultureInfo.InvariantCulture) ?? string.Empty;
            var path = ResolveFixturePath(raw);
            var bytes = File.ReadAllBytes(path);
            var fileName = Path.GetFileName(path);
            var fileContent = new ByteArrayContent(bytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue(GuessMimeType(fileName));
            content.Add(fileContent, file.Key, fileName);
        }

        return content;
    }

    protected static void ExtractInto(
        Dictionary<string, object?> ctx,
        string key,
        JsonElement response,
        string fieldPath
    )
    {
        if (!TryResolveFieldPath(response, fieldPath, out var value))
        {
            return;
        }
        var converted = ConvertJsonElement(value);
        if (converted != null)
        {
            ctx[key] = converted;
        }
    }

    protected static void AssertResponseShape(
        JsonElement response,
        (string name, bool required, bool nullable)[] fields
    )
    {
        Assert.True(response.ValueKind == JsonValueKind.Object, "Response is not a JSON object.");
        foreach (var field in fields)
        {
            var hasProp = response.TryGetProperty(field.name, out var prop);
            if (!hasProp)
            {
                Assert.False(field.required, $"Missing required field '{field.name}'.");
                continue;
            }
            if (field.required && !field.nullable)
            {
                Assert.NotEqual(JsonValueKind.Null, prop.ValueKind);
            }
        }
    }

    private static object? ConvertJsonElement(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.Undefined => null,
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Object => JsonSerializer.Deserialize<Dictionary<string, object?>>(element.GetRawText(), JsonOptions),
            JsonValueKind.Array => JsonSerializer.Deserialize<List<object?>>(element.GetRawText(), JsonOptions),
            _ => null,
        };
    }

    private static bool TryResolveFieldPath(
        JsonElement root,
        string fieldPath,
        out JsonElement value
    )
    {
        value = root;
        foreach (var segment in ParseFieldPath(fieldPath))
        {
            if (segment.isIndex)
            {
                if (value.ValueKind != JsonValueKind.Array) return false;
                var items = value.EnumerateArray().ToList();
                if (segment.index < 0 || segment.index >= items.Count) return false;
                value = items[segment.index];
            }
            else
            {
                if (value.ValueKind != JsonValueKind.Object) return false;
                if (!value.TryGetProperty(segment.name, out var child)) return false;
                value = child;
            }
        }
        return true;
    }

    protected static string ResolveFixturePath(string rawPath)
    {
        var path = rawPath.StartsWith("@@FILE:", StringComparison.Ordinal)
            ? rawPath.Substring("@@FILE:".Length)
            : rawPath;
        if (Path.IsPathRooted(path) && File.Exists(path)) return path;

        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "fixtures", path),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "fixtures", path),
            Path.Combine(Directory.GetCurrentDirectory(), "fixtures", path),
        };
        foreach (var candidate in candidates)
        {
            var full = Path.GetFullPath(candidate);
            if (File.Exists(full)) return full;
        }
        return Path.Combine(AppContext.BaseDirectory, "fixtures", path);
    }

    private static string GuessMimeType(string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".bpmn" or ".dmn" or ".xml" => "application/xml",
            ".json" or ".form" => "application/json",
            _ => "application/octet-stream",
        };
    }

    private static IEnumerable<(string name, int index, bool isIndex)> ParseFieldPath(string path)
    {
        var i = 0;
        while (i < path.Length)
        {
            if (path[i] == '.')
            {
                i++;
                continue;
            }
            if (path[i] == '[')
            {
                var end = path.IndexOf(']', i + 1);
                if (end < 0) yield break;
                var raw = path.Substring(i + 1, end - i - 1);
                if (int.TryParse(raw, out var idx))
                {
                    yield return (string.Empty, idx, true);
                }
                i = end + 1;
                continue;
            }
            var start = i;
            while (i < path.Length && path[i] != '.' && path[i] != '[') i++;
            var name = path.Substring(start, i - start);
            if (name.Length > 0) yield return (name, -1, false);
        }
    }

    private sealed class SeedEnv
    {
        private static readonly Lazy<SeedEnv> LazyInstance = new(() => new SeedEnv());
        public static SeedEnv Instance => LazyInstance.Value;

        private readonly Dictionary<string, int> counters = new();
        private readonly Random random;
        private readonly string runId;

        private SeedEnv()
        {
            var raw = Environment.GetEnvironmentVariable("TEST_SEED");
            var useRandom = string.Equals(raw, "random", StringComparison.OrdinalIgnoreCase);
            var seed = string.IsNullOrWhiteSpace(raw) ? "snapshot-baseline" : raw!;
            if (useRandom)
            {
                random = new Random();
                runId = $"rt-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds():x}";
            }
            else
            {
                random = new Random(HashSeed(seed));
                runId = $"det-{seed}";
            }
        }

        public string Generate(string varName)
        {
            if (varName == "RANDOM")
            {
                return RandomBase36(6);
            }
            if (varName == "tenantIdVar")
            {
                return "<default>";
            }
            if (Regex.IsMatch(varName, "correlation", RegexOptions.IgnoreCase))
            {
                return $"corr-{runId}-{NextCounter("corr")}-{RandomBase36(4)}";
            }
            if (Regex.IsMatch(varName, "(key|id)$", RegexOptions.IgnoreCase))
            {
                return $"{varName}-{runId}-{NextCounter("id")}-{RandomBase36(6)}";
            }
            if (Regex.IsMatch(varName, "name", RegexOptions.IgnoreCase))
            {
                return $"{varName}-{RandomBase36(8)}";
            }
            return $"{varName}-{RandomBase36(6)}";
        }

        private int NextCounter(string bucket)
        {
            counters.TryGetValue(bucket, out var current);
            var next = current + 1;
            counters[bucket] = next;
            return next;
        }

        private string RandomBase36(int length)
        {
            const string alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
            var buffer = new char[length];
            for (var i = 0; i < length; i++)
            {
                buffer[i] = alphabet[random.Next(alphabet.Length)];
            }
            return new string(buffer);
        }

        private static int HashSeed(string seed)
        {
            unchecked
            {
                var hash = 23;
                foreach (var ch in seed)
                {
                    hash = (hash * 31) + ch;
                }
                return hash;
            }
        }
    }
}
