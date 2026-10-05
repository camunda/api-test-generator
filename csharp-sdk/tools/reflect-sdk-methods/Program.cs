using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Camunda.Orchestration.Sdk;

var outputPath = args.Length > 0
    ? Path.GetFullPath(args[0])
    : Path.GetFullPath("csharp-sdk/examples/sdk-client-methods.json");

var methods = typeof(CamundaClient)
    .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
    .Where(method => !method.IsSpecialName)
    .OrderBy(method => method.Name, StringComparer.Ordinal)
    .Select(method => new SdkMethod(
        method.Name,
        method.GetParameters()
            .Select(parameter => new SdkParameter(
                parameter.Name ?? string.Empty,
                parameter.ParameterType.FullName ?? parameter.ParameterType.Name,
                parameter.IsOptional || parameter.HasDefaultValue))
            .ToArray(),
        method.ReturnType.FullName ?? method.ReturnType.Name))
    .ToArray();

Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
var json = JsonSerializer.Serialize(
    new SdkMethodManifest("9.2.2", methods),
    new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase }
);
File.WriteAllText(outputPath, json + Environment.NewLine);

public sealed record SdkMethodManifest(string SdkVersion, IReadOnlyList<SdkMethod> Methods);

public sealed record SdkMethod(
    string Name,
    IReadOnlyList<SdkParameter> Parameters,
    string ReturnType
);

public sealed record SdkParameter(string Name, string Type, bool Optional);
