/**
 * Materialize C# SDK test support files into the generated output directory.
 *
 * Vendors a self-contained .NET project skeleton so the generated test suite
 * is runnable standalone without any dependency on this generator project.
 *
 * Files materialized:
 *   - CamundaIntegrationTests.csproj — .NET 8 project file referencing the Camunda REST SDK
 *   - .env.example  — environment variable template for local / SaaS configuration
 *   - README.md     — how to build and run the generated suite
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Camunda.Orchestration.RestSdk" Version="*" />
    <PackageReference Include="DotNetEnv" Version="3.*" />
  </ItemGroup>

</Project>
`;

const ENV_EXAMPLE = `# Camunda REST API connection settings
# Copy this file to .env and fill in the values.

# Local / Self-Managed
CAMUNDA_BASE_URL=http://localhost:8080/v2/

# SaaS (OAuth2) — leave blank for local/self-managed
CAMUNDA_CLIENT_ID=
CAMUNDA_CLIENT_SECRET=
CAMUNDA_OAUTH_URL=
`;

const README_MD = `# Generated C# SDK Integration Tests

Auto-generated test suite targeting the Camunda REST API via
[Camunda.Orchestration.RestSdk](https://github.com/camunda/camunda-orchestration-rest-sdk-csharp).

## Prerequisites

- [.NET 8+](https://dotnet.microsoft.com/download)
- A running Camunda instance (local or SaaS)

## Setup

1. Copy **.env.example** to **.env** and fill in the connection details.
2. Restore dependencies:

   \`\`\`bash
   dotnet restore
   \`\`\`

## Running the suite

\`\`\`bash
dotnet run
\`\`\`

Or call the static methods in \`csharp/*.cs\` directly from a custom entry point.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| \`CAMUNDA_BASE_URL\` | \`http://localhost:8080/v2/\` | Camunda REST API base URL |
| \`CAMUNDA_CLIENT_ID\` | — | OAuth2 client ID (SaaS only) |
| \`CAMUNDA_CLIENT_SECRET\` | — | OAuth2 client secret (SaaS only) |
| \`CAMUNDA_OAUTH_URL\` | — | OAuth2 token endpoint URL (SaaS only) |
`;

/**
 * Materialize C# project scaffolding into `<outDir>/` so the emitted C# SDK
 * suite is self-contained and runnable in place (`cd <outDir> && dotnet run`).
 *
 * Idempotent: safe to call multiple times per emit run.
 *
 * @param outDir         Directory to materialise into (created if missing).
 * @param overwriteRoot  When false, root scaffold files are only written if
 *                       they do not already exist. Default: true.
 */
export async function materializeCsharpSupport(
  outDir: string,
  overwriteRoot = true,
): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  // Ensure the csharp/ subdirectory that the emitter writes .cs files into exists.
  await fs.mkdir(path.join(outDir, 'csharp'), { recursive: true });

  const writeRoot = async (filename: string, content: string): Promise<void> => {
    const dest = path.join(outDir, filename);
    if (!overwriteRoot) {
      try {
        await fs.access(dest);
        return; // already exists — skip
      } catch {
        // does not exist — fall through to write
      }
    }
    await fs.writeFile(dest, content, 'utf8');
  };

  await writeRoot('CamundaIntegrationTests.csproj', CSPROJ);
  await writeRoot('.env.example', ENV_EXAMPLE);
  await writeRoot('README.md', README_MD);
}
