using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Camunda.Orchestration.Sdk;

var outputPath = args.Length > 0
    ? Path.GetFullPath(args[0])
    : Path.GetFullPath("csharp-sdk/examples/sdk-client-methods.json");

var assembly = typeof(CamundaClient).Assembly;
var sdkTypes = GetSdkTypes(assembly);
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
var derivedTypes = sdkTypes
    .Where(type => type.BaseType is not null && IsSdkType(type.BaseType))
    .Select(type => new SdkDerivedType(type.FullName!, type.BaseType!.FullName!))
    .OrderBy(type => type.Name, StringComparer.Ordinal)
    .ToArray();

Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
var json = JsonSerializer.Serialize(
    new SdkMethodManifest("9.2.2", methods, derivedTypes),
    new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase }
);
File.WriteAllText(outputPath, json + Environment.NewLine);

static Type[] GetSdkTypes(Assembly assembly)
{
    try
    {
        return assembly.GetTypes();
    }
    catch (ReflectionTypeLoadException exception)
    {
        return exception.Types.OfType<Type>().ToArray();
    }
}

static bool IsSdkType(Type type)
{
    return type.FullName?.StartsWith("Camunda.Orchestration.Sdk.", StringComparison.Ordinal) == true;
}

public sealed record SdkMethodManifest(
    string SdkVersion,
    IReadOnlyList<SdkMethod> Methods,
    IReadOnlyList<SdkDerivedType> DerivedTypes
);

public sealed record SdkMethod(
    string Name,
    IReadOnlyList<SdkParameter> Parameters,
    string ReturnType
);

public sealed record SdkParameter(string Name, string Type, bool Optional);

public sealed record SdkDerivedType(string Name, string BaseType);
