import { describe, expect, it } from 'vitest'

// A lint-style guard for the Frontend conventions in CLAUDE.md and DESIGN.md § Visual design, so the
// accessibility pass (#38) stays true: tokens only, text money inputs, one currency formatter.
const sources = import.meta.glob(['../**/*.{js,jsx}', '!../**/*.test.{js,jsx}', '!../tests/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

function offenders(pattern, { except = () => false } = {}) {
  const found = []
  for (const [path, raw] of Object.entries(sources)) {
    if (except(path)) continue
    stripComments(raw)
      .split('\n')
      .forEach((line, i) => {
        if (pattern.test(line)) found.push(`${path}:${i + 1}: ${line.trim()}`)
      })
  }
  return found
}

const isFormat = (path) => path.endsWith('/utils/format.js')

describe('frontend conventions', () => {
  it('finds the source files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20)
  })

  it('holds no hex colour in JSX or JS (tokens only)', () => {
    expect(offenders(/['"`#]#[0-9a-fA-F]{3,8}\b|\[#[0-9a-fA-F]{3,8}\]|\b(rgb|hsl)a?\(/)).toEqual([])
  })

  it('uses no raw palette colours, opacity tricks or light weights', () => {
    expect(
      offenders(/\b(?:bg|text|border|ring|fill|stroke)-(?:white|black|gray|grey|slate|zinc|neutral|stone|red|green|blue|indigo)\b|\b(?:bg|text|border|ring)-[a-z0-9-]+\/\d+|\bopacity-(?:[0-9]|[1-4][0-9])\b|\bfont-(?:thin|extralight|light)\b|\btext-\[/),
    ).toEqual([])
  })

  it('has no number-type input (money fields are text with the decimal keypad)', () => {
    expect(offenders(/type=["']number["']/)).toEqual([])
  })

  it('formats money and dates only through utils/format.js', () => {
    expect(offenders(/\.toFixed\(|\.toLocale\w*\(|Intl\.(?:NumberFormat|DateTimeFormat)/, { except: isFormat })).toEqual([])
  })

  it('never reads the wall clock for a date outside the one helper', () => {
    expect(offenders(/\bnew Date\(\)|Date\.now\(\)/, { except: (p) => isFormat(p) })).toEqual([])
  })
})
