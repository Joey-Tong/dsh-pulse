/**
 * Vendored client-bundle builder, adapted from the official DeepSeek Harness
 * `packages/client/tsdown.client.ts` (MIT, Copyright DeepSeek). Keeps the
 * loader handoff protocol, externals table, CSS-module injection, and purity
 * gate byte-compatible with the harness build so the produced bundle works
 * with the running web shell unchanged.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/**
 * The platform module table (mirror of the official web platform.ts): the
 * shell shares these into the frozen module table, so bundles keep them
 * external and answer them through the injected loader require.
 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/**
 * Documented temporary exemption in the official build (the snapshot-store
 * engine lives in runtime pending rehoming); kept identical so a bundle
 * importing the runtime client resolves the same way it does in-tree.
 */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

/** Externals resolved from the loader module table. */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

/** Wire/type layers a client bundle may inline (mirror of the official gate). */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

/** Vendored framework libraries that are ordinary inlinable libraries. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * tsdown config for the dsh-pulse client bundle: emits lib/client.js wrapped
 * in the `window.__ModuleLoader__.load({ id, factory })` handoff, with CSS
 * modules compiled by lightningcss and injected as <style data-plugin> tags.
 */
export function pulseClientBundle(id: string, entry: string): UserConfig {
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (specifier: string) => (CLIENT_EXTERNALS.includes(specifier) ? undefined : true),
    plugins: [{
      name: 'dsh-pulse-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null
        if (VENDORED_LIBRARY.test(source)) return null
        if (INLINE_SAFE.test(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module, an inline-safe wire layer, `
          + 'or a generated /remote contribution — cross-plugin value imports are forbidden',
        )
      },
    }, {
      name: 'dsh-pulse-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        const tagId = `${id}/${basename(fileId)}`
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(tagId)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(id)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapPathTransform: (source: string, sourcemapPath: string) => browserSourcePath(source, sourcemapPath),
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/** Rebase a lib-relative source onto a browser URL mirroring the repo layout. */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith('.')) return source
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  return physicalSource
}

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}
