/**
 * JavaScript SDK request body source code generation.
 *
 * This module provides JavaScript-specific utilities for rendering request bodies.
 */
/**
 * Render a request body as a JavaScript object, substituting placeholder variables.
 *
 * Replaces "${varName}" placeholders with ctx['varName'] references.
 * Handles nested structures by working with the JSON representation.
 *
 * @example
 * renderJavaScriptBody({ name: "${userName}" }, {...})
 * → { name: ctx['userName'] }
 *
 * @param bodyTemplate Request body template (may contain ${...} placeholders)
 * @param bindings Available context bindings (for validation if needed)
 * @returns JavaScript code that evaluates to the body object
 */
export function renderJavaScriptBody(
  bodyTemplate: unknown,
  _bindings: Record<string, string | undefined> = {},
): string {
  if (!bodyTemplate) return '{}';

  function render(value: unknown, indent: string): string {
    if (typeof value === 'string') {
      const fileMatch = value.match(/^@@FILE:(.+)$/);
      if (fileMatch) return `await resolveFixture(${JSON.stringify(fileMatch[1])})`;
      const bindingMatch = value.match(/^\\?\$\{([^}]+)\}$/);
      if (bindingMatch && bindingMatch[1] !== 'RANDOM') return `ctx['${bindingMatch[1]}']`;
      // A literal `${RANDOM}` (whole-string or embedded in a larger literal
      // like 'proc_${RANDOM}') is a planner-minted runtime seed token, not a
      // ctx binding (Copilot PR #575 review) -- it must survive verbatim.
      // Any other embedded `${var}` alongside literal text (e.g.
      // 'proc-${processInstanceKeyVar}-${tenantIdVar}') is rendered as a
      // genuine JS template literal so both the literal text and the real
      // ctx binding(s) are preserved.
      if (HAS_PLACEHOLDER_RE.test(value)) return renderJavaScriptTemplateLiteral(value);
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const childIndent = `${indent}  `;
      return `[\n${value.map((item) => `${childIndent}${render(item, childIndent)}`).join(',\n')}\n${indent}]`;
    }
    if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value);
      if (entries.length === 0) return '{}';
      const childIndent = `${indent}  `;
      return `{\n${entries
        .map(([key, item]) => `${childIndent}${JSON.stringify(key)}: ${render(item, childIndent)}`)
        .join(',\n')}\n${indent}}`;
    }
    return JSON.stringify(value);
  }

  return render(bodyTemplate, '');
}

// `.matchAll()` requires the `g` flag; the presence check below uses a
// separate non-global regex so repeated `.test()` calls (one per rendered
// string) don't mutate a shared `lastIndex` and silently skip matches.
const EMBEDDED_PLACEHOLDER_RE = /\$\{([^}]+)\}/g;
const HAS_PLACEHOLDER_RE = /\$\{[^}]+\}/;

/**
 * Escape text that will be embedded as the literal portion of a JS
 * template literal: backslashes, backticks, and any literal `${` sequence
 * that isn't one of the placeholders we're substituting.
 */
function escapeJsTemplateLiteralText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/**
 * Render a string containing one or more `${var}` placeholders mixed with
 * literal text as a genuine JS template literal. Non-RANDOM placeholders
 * are lowered to a real `${ctx['var']}` interpolation; `${RANDOM}` is
 * escaped so it survives verbatim rather than being evaluated as an
 * interpolation referencing an undefined `RANDOM` identifier.
 */
function renderJavaScriptTemplateLiteral(value: string): string {
  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(EMBEDDED_PLACEHOLDER_RE)) {
    parts.push(escapeJsTemplateLiteralText(value.slice(lastIndex, match.index)));
    if (match[1] === 'RANDOM') {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal escaped `${RANDOM}` seed token text to embed verbatim in the emitted template literal
      parts.push('\\${RANDOM}');
    } else {
      parts.push(`\${ctx['${match[1]}']}`);
    }
    lastIndex = match.index + match[0].length;
  }
  parts.push(escapeJsTemplateLiteralText(value.slice(lastIndex)));
  return `\`${parts.join('')}\``;
}

export function renderJavaScriptMultipartBody(template: unknown): string {
  if (typeof template !== 'object' || template === null || Array.isArray(template)) return '{}';
  const fields =
    'fields' in template && typeof template.fields === 'object' && template.fields !== null
      ? template.fields
      : {};
  const files =
    'files' in template && typeof template.files === 'object' && template.files !== null
      ? template.files
      : {};
  const entries = [
    ...Object.entries(fields).map(
      ([key, value]) => `${JSON.stringify(key)}: ${renderJavaScriptBody(value)}`,
    ),
    ...Object.entries(files).map(([key, value]) => {
      const values = Array.isArray(value) ? value : [value];
      const rendered = values.map((item) => {
        if (typeof item === 'string' && item.startsWith('@@FILE:')) {
          const relativePath = item.slice('@@FILE:'.length);
          const fileName = relativePath.split('/').pop() ?? relativePath;
          return `new File([await resolveFixture(${JSON.stringify(relativePath)})], ${JSON.stringify(fileName)})`;
        }
        return renderJavaScriptBody(item);
      });
      return `${JSON.stringify(key)}: [${rendered.join(', ')}]`;
    }),
  ];
  return `{\n${entries.map((entry) => `  ${entry}`).join(',\n')}\n}`;
}

export function containsJavaScriptFixtureMarker(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('@@FILE:');
  if (Array.isArray(value)) return value.some(containsJavaScriptFixtureMarker);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(containsJavaScriptFixtureMarker);
  }
  return false;
}
