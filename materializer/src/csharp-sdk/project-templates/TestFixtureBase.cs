using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Camunda.Orchestration.Sdk;
using Xunit;

namespace CamundaIntegrationTests;

public abstract class TestFixtureBase
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new StringValueObjectConverterFactory() },
    };

    protected CamundaClient Client { get; }

    protected TestFixtureBase()
    {
        Client = CamundaClient.Create();
    }

    protected static void SeedBindingIfMissing(
        Dictionary<string, object?> ctx,
        string binding,
        string seedRule,
        bool unique = false
    )
    {
        if (!ctx.TryGetValue(binding, out var value) || value == null)
        {
            ctx[binding] = SeedBinding(seedRule, unique);
        }
    }

    protected static string SeedBinding(string varName, bool unique = false)
    {
        return SeedEnv.Instance.Generate(varName, unique);
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

    protected static string? RequireStringBinding(Dictionary<string, object?> ctx, string key)
    {
        var value = RequireBinding(ctx, key);
        return value as string ?? value?.ToString();
    }

    /// <summary>
    /// Read an optional (<c>omitWhenUnbound</c>, #342) binding without
    /// throwing when it is absent. Unlike <see cref="RequireBinding"/>, a
    /// missing/null binding returns <c>null</c> so the caller can omit the
    /// field entirely and let the broker apply its own default, instead of
    /// failing a legitimate consumer scenario that never seeded this value.
    /// </summary>
    protected static object? GetBindingOrNull(Dictionary<string, object?> ctx, string binding)
    {
        return ctx.TryGetValue(binding, out var value) ? value : null;
    }

    protected static string? GetStringBindingOrNull(Dictionary<string, object?> ctx, string binding)
    {
        var value = GetBindingOrNull(ctx, binding);
        return value as string ?? value?.ToString();
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

    /// <summary>
    /// Convert an SDK response to a JsonElement suitable for field-path
    /// extraction/assertion. Many SDK response types (e.g.
    /// <c>ExtendedDeploymentResponse</c>) are C#-ergonomic wrappers around a
    /// <c>Raw</c> property holding the true wire-shape DTO (camelCase
    /// property names matching the OpenAPI contract) alongside redundant
    /// PascalCase convenience mirrors. Serializing the wrapper directly
    /// produces a JSON object with duplicate camelCase/PascalCase keys, and
    /// our field paths (authored against the wire contract, e.g.
    /// <c>deployments[0].processDefinition.processDefinitionKey</c>) only
    /// match the nested <c>Raw</c> shape -- so prefer it when present.
    /// </summary>
    protected static JsonElement ToJsonElement(object? response)
    {
        if (response is JsonElement elem)
        {
            return elem.Clone();
        }
        if (response is not null)
        {
            var rawProp = response.GetType().GetProperty("Raw");
            if (rawProp is not null)
            {
                response = rawProp.GetValue(response);
            }
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

    /// <summary>
    /// Unwrap a JSON value pulled out by field-path extraction into a plain
    /// CLR scalar/collection. Strongly-typed SDK key structs (JobKey,
    /// ProcessInstanceKey, ...) have no custom JSON converter registered for
    /// our own serialization pass, so they round-trip as a single-property
    /// object <c>{"Value": "..."}</c> rather than a bare string. Left
    /// unwrapped, that object would be stored in the test context as a
    /// Dictionary, and a later <c>RequireStringBinding</c> would stringify
    /// the dictionary itself (garbage) instead of the key's real value --
    /// silently corrupting every downstream key-typed path parameter.
    /// </summary>
    private static object? ConvertJsonElement(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var props = element.EnumerateObject().ToList();
            // Ordinal, case-sensitive: the key-struct converter always emits
            // exactly "Value" (PascalCase). A case-insensitive match would also
            // unwrap legitimate wire JSON shaped like {"value": ...}, silently
            // collapsing a real response object down to its scalar field.
            if (props.Count == 1 && string.Equals(props[0].Name, "Value", StringComparison.Ordinal))
            {
                return ConvertJsonElement(props[0].Value);
            }
        }
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

    /// <summary>
    /// Handles the SDK's pervasive "string-backed value object" struct
    /// pattern (JobKey, ProcessDefinitionKey, TenantId, Tag, ...): a
    /// readonly struct with a single <c>string Value</c> property and a
    /// <c>static T AssumeExists(string)</c> factory, with no
    /// <c>[JsonConverter]</c> registered by the SDK itself. Without this,
    /// <see cref="JsonSerializer"/> round-trips these as
    /// <c>{"Value": "..."}</c> objects on write and refuses to deserialize
    /// a plain JSON string into them on read -- breaking both
    /// <see cref="BuildRequest{T}"/> (building a request body field typed
    /// as one of these structs from a plain extracted string) and
    /// <see cref="ToJsonElement"/> (field-path extraction expects a plain
    /// scalar, not a nested object).
    /// </summary>
    private sealed class StringValueObjectConverterFactory : JsonConverterFactory
    {
        public override bool CanConvert(Type typeToConvert)
        {
            if (!typeToConvert.IsValueType) return false;
            var valueProp = typeToConvert.GetProperty("Value", BindingFlags.Public | BindingFlags.Instance);
            if (valueProp is null || valueProp.PropertyType != typeof(string)) return false;
            var factory = typeToConvert.GetMethod(
                "AssumeExists", BindingFlags.Public | BindingFlags.Static, null, new[] { typeof(string) }, null);
            return factory is not null && factory.ReturnType == typeToConvert;
        }

        public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options)
        {
            var converterType = typeof(StringValueObjectConverter<>).MakeGenericType(typeToConvert);
            return (JsonConverter)Activator.CreateInstance(converterType)!;
        }

        private sealed class StringValueObjectConverter<T> : JsonConverter<T>
        {
            private static readonly MethodInfo AssumeExistsMethod = typeof(T).GetMethod(
                "AssumeExists", BindingFlags.Public | BindingFlags.Static, null, new[] { typeof(string) }, null)!;
            private static readonly PropertyInfo ValueProperty =
                typeof(T).GetProperty("Value", BindingFlags.Public | BindingFlags.Instance)!;

            public override T Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
            {
                var raw = reader.GetString();
                if (raw is null)
                {
                    throw new JsonException($"Cannot convert null to {typeof(T).Name}.");
                }
                return (T)AssumeExistsMethod.Invoke(null, new object?[] { raw })!;
            }

            public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options)
            {
                var raw = (string?)ValueProperty.GetValue(value);
                writer.WriteStringValue(raw);
            }
        }
    }

    private sealed class SeedEnv
    {
        private static readonly Lazy<SeedEnv> LazyInstance = new(() => new SeedEnv());
        public static SeedEnv Instance => LazyInstance.Value;

        private static string? _runNonce;

        private readonly Dictionary<string, int> counters = new();
        private readonly Dictionary<string, int> uniqueCounters = new();
        private readonly Random random;
        private readonly Random uniqueRandom;
        private readonly string runId;
        private readonly string uniqueRunId;
        // xUnit runs test classes/collections in parallel by default, and this
        // singleton (Random + Dictionary counters) is shared across all of them --
        // neither System.Random nor Dictionary<TKey,TValue> is thread-safe, so
        // concurrent Generate() calls can corrupt PRNG state or the counters,
        // producing colliding/garbage generated identifiers.
        private readonly object gate = new();

        private SeedEnv()
        {
            var raw = Environment.GetEnvironmentVariable("TEST_SEED");
            var useRandom = string.Equals(raw, "random", StringComparison.OrdinalIgnoreCase);
            var seed = string.IsNullOrWhiteSpace(raw) ? "snapshot-baseline" : raw!;
            if (useRandom)
            {
                random = new Random();
                uniqueRandom = new Random();
                runId = $"rt-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds():x}";
                uniqueRunId = runId;
            }
            else
            {
                random = new Random(HashSeed(seed));
                runId = $"det-{seed}";
                // A separate PRNG stream + runId, seeded with a per-process
                // nonce mixed in, so `unique: true` bindings (client-minted
                // identifiers consumed by an op that declares HTTP 409)
                // differ across separate run invocations instead of
                // colliding on the previous run's value. Mirrors
                // _resolveRunNonce() in
                // materializer/src/playwright/support/seeding.ts.
                var nonce = ResolveRunNonce();
                uniqueRandom = new Random(HashSeed(seed + nonce));
                uniqueRunId = $"det-{seed}-{nonce}";
            }
        }

        private static string ResolveRunNonce()
        {
            if (_runNonce is not null) return _runNonce;
            var env = Environment.GetEnvironmentVariable("TEST_RUN_NONCE");
            _runNonce = !string.IsNullOrEmpty(env) ? env : Guid.NewGuid().ToString("n");
            return _runNonce;
        }

        public string Generate(string varName, bool unique = false)
        {
            lock (gate)
            {
                var rnd = unique ? uniqueRandom : random;
                var id = unique ? uniqueRunId : runId;
                var bucket = unique ? uniqueCounters : counters;

                if (varName == "RANDOM")
                {
                    return RandomBase36(rnd, 6);
                }
                if (Regex.IsMatch(varName, "correlation", RegexOptions.IgnoreCase))
                {
                    return $"corr-{id}-{NextCounter(bucket, "corr")}-{RandomBase36(rnd, 4)}";
                }
                if (Regex.IsMatch(varName, "(key|id)$", RegexOptions.IgnoreCase))
                {
                    return $"{varName}-{id}-{NextCounter(bucket, "id")}-{RandomBase36(rnd, 6)}";
                }
                if (Regex.IsMatch(varName, "name", RegexOptions.IgnoreCase))
                {
                    return $"{varName}-{RandomBase36(rnd, 8)}";
                }
                return $"{varName}-{RandomBase36(rnd, 6)}";
            }
        }

        private static int NextCounter(Dictionary<string, int> counters, string bucket)
        {
            counters.TryGetValue(bucket, out var current);
            var next = current + 1;
            counters[bucket] = next;
            return next;
        }

        private static string RandomBase36(Random rnd, int length)
        {
            const string alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
            var buffer = new char[length];
            for (var i = 0; i < length; i++)
            {
                buffer[i] = alphabet[rnd.Next(alphabet.Length)];
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
