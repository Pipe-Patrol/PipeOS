/**
 * Every word the console can put on screen, in one list.
 *
 * There is no string table in this codebase — copy lives next to the component
 * that shows it, which is the right trade for a console this size but makes it
 * impossible to read the product's writing as a whole. This walks the source
 * and pulls out anything an operator could end up reading, so it can be
 * reviewed in one sitting rather than discovered a phrase at a time.
 *
 *   node scripts/copy-audit.mjs            print it
 *   node scripts/copy-audit.mjs --count    just the total
 *   node scripts/copy-audit.mjs > copy.md  keep a copy to mark up
 *
 * It is a reader, not a compiler: it works on text, so expect it to miss a
 * string built at runtime and to catch the occasional identifier. Being roughly
 * complete and instantly re-runnable beats being exact and unused.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../src', import.meta.url).pathname

/** Attributes whose value is read by a person rather than by a browser. */
const COPY_ATTRIBUTES = [
  'label',
  'hint',
  'title',
  'placeholder',
  'aria-label',
  'alt',
  'detail',
  'instruction',
  'info',
  'message',
  'note',
  'reason',
  'lockHint',
]

/**
 * Anything matching these is code or styling that leaked through. The awkward
 * ones are the type annotations: `Record<{ a: string; b: string }>` looks
 * exactly like markup with text in it, so a candidate carrying punctuation that
 * belongs to a program and not to a sentence is dropped.
 */
const NOT_COPY = [
  /^[a-z0-9-]+$/, // single lowercase token: a prop name, a css class, an id
  /^[\d\s.,:%-]+$/, // pure numbers and punctuation
  /[{}<>=;()[\]|]/, // unresolved JSX, generics, expressions
  /^[,.;:]/, // a fragment sliced out of the middle of a declaration
  /:$/, // an object key with its value cut off
  /^(https?:|\/|\.\/|@\/)/, // urls and import paths
  /(^|\s)(flex|grid|rounded|border|text-|bg-|gap-|px-|py-|mt-|min-|max-)/,
]

function isCopy(text) {
  const trimmed = text.trim()
  if (trimmed.length < 2) return false
  if (!/[a-z]{2}/i.test(trimmed)) return false
  return !NOT_COPY.some((pattern) => pattern.test(trimmed))
}

/** Strip what would otherwise drown the output: styles, imports, comments. */
function declutter(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
    .replace(/className=\{`[\s\S]*?`\}/g, 'className=""')
    .replace(/className=\{[^}]*\}/g, 'className=""')
    .replace(/className="[^"]*"/g, 'className=""')
}

function extract(source) {
  const found = new Map()
  const add = (text, index) => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!isCopy(clean)) return
    if (!found.has(clean)) found.set(clean, index)
  }

  const lineOf = (index) => source.slice(0, index).split('\n').length

  // Text sitting directly in the markup.
  for (const match of source.matchAll(/>([^<>{}]+)</g)) {
    add(match[1], match.index)
  }

  // Values of the attributes a person reads.
  const attributes = COPY_ATTRIBUTES.join('|')
  for (const match of source.matchAll(
    new RegExp(`\\b(?:${attributes})=(?:"([^"]+)"|\\{'([^']+)'\\})`, 'g'),
  )) {
    add(match[1] ?? match[2], match.index)
  }

  // Copy held as object properties: the shortcut table, the mode list, the
  // defect types. Single words live here too, so this cannot require a space.
  for (const match of source.matchAll(
    new RegExp(`\\b(?:${attributes}|action|group)\\s*:\\s*'([^'\\n]+)'`, 'g'),
  )) {
    add(match[1], match.index)
  }

  // Quoted sentences anywhere else: ternaries in JSX, checklist arrays,
  // thrown messages. Requires a space, which is what separates a sentence
  // from an identifier.
  for (const match of source.matchAll(/'([^'\\\n]*\s[^'\\\n]*)'/g)) {
    add(match[1], match.index)
  }
  for (const match of source.matchAll(/`([^`$\\\n]*\s[^`$\\\n]*)`/g)) {
    add(match[1], match.index)
  }

  return [...found].map(([text, index]) => ({ text, line: lineOf(index) }))
}

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) files.push(...walk(path))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(path)
  }
  return files
}

const results = walk(ROOT)
  .map((path) => ({
    path: relative(ROOT, path),
    strings: extract(declutter(readFileSync(path, 'utf8'))),
  }))
  .filter((file) => file.strings.length > 0)
  .sort((a, b) => a.path.localeCompare(b.path))

const total = results.reduce((sum, file) => sum + file.strings.length, 0)

if (process.argv.includes('--count')) {
  console.log(total)
} else {
  console.log(`# Console copy\n\n${total} strings across ${results.length} files.\n`)
  for (const file of results) {
    console.log(`## ${file.path}\n`)
    for (const { text, line } of file.strings) {
      console.log(`- \`${line}\` ${text}`)
    }
    console.log('')
  }
}
