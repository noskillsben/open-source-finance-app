import Markdown from 'react-markdown'
// The user guide, bundled at build time: Help always describes the version that is running, and there is
// no second copy of help text. In the containers docs/user is at /docs/user (see the compose files).
import guide from '../../docs/user/README.md?raw'

// Tailwind tokens and type only. Long lines wrap; a code block scrolls inside itself and never widens the page.
const components = {
  h1: (p) => <h2 className="page-title mb-4 break-words" {...strip(p)} />,
  h2: (p) => <h3 className="mb-2 mt-8 break-words text-section" {...strip(p)} />,
  h3: (p) => <h4 className="mb-2 mt-6 break-words text-base font-semibold" {...strip(p)} />,
  p: (p) => <p className="my-3 break-words text-text-2" {...strip(p)} />,
  ul: (p) => <ul className="my-3 list-disc space-y-3 pl-5 text-text-2" {...strip(p)} />,
  ol: (p) => <ol className="my-3 list-decimal space-y-3 pl-5 text-text-2" {...strip(p)} />,
  li: (p) => <li className="break-words" {...strip(p)} />,
  strong: (p) => <strong className="font-semibold text-text" {...strip(p)} />,
  a: ({ href, children }) => {
    const external = /^https?:\/\//.test(href ?? '') && !/^https?:\/\/localhost(:|\/|$)/.test(href)
    return (
      <a
        href={href}
        className="break-words text-accent underline"
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </a>
    )
  },
  pre: (p) => <pre className="my-3 max-w-full overflow-x-auto rounded-lg bg-surface p-3 text-sm" {...strip(p)} />,
  code: ({ className, children }) => (
    <code className={`${className ?? ''} rounded bg-raised px-1 text-sm text-text [pre_&]:bg-transparent [pre_&]:p-0`}>{children}</code>
  ),
}

// react-markdown passes the syntax-tree node as a prop; keep it off the DOM element.
function strip(props) {
  const rest = { ...props }
  delete rest.node
  return rest
}

export default function Help() {
  return (
    <article aria-label="User guide" className="max-w-3xl pb-8">
      <Markdown components={components}>{guide}</Markdown>
    </article>
  )
}
