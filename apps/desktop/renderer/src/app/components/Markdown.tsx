/**
 * Markdown — a small, dependency-free, injection-safe markdown renderer.
 *
 * This component turns a markdown source string into React elements. It builds
 * a real React element tree (never `dangerouslySetInnerHTML`), so user note
 * content can NEVER inject HTML, scripts, or event handlers into the app. Any
 * raw HTML in the source is treated as literal text.
 *
 * Supported syntax (a pragmatic subset for secure notes):
 *   - Headings:        # .. ###### at the start of a line
 *   - Unordered lists: lines starting with `- `, `* `, or `+ `
 *   - Ordered lists:   lines starting with `1. ` (any number)
 *   - Blockquotes:     lines starting with `> `
 *   - Fenced code:     ```-delimited blocks (rendered verbatim, no inline parse)
 *   - Horizontal rule: `---`, `***`, or `___` on their own line
 *   - Inline:          **bold**, *italic* / _italic_, `code`, and
 *                      [text](http/https/mailto link)
 *
 * Links are restricted to http(s)/mailto schemes; anything else renders as
 * plain text, so `javascript:` and similar pseudo-schemes cannot slip through.
 *
 * Security posture: because output is a React element tree, all text content is
 * escaped by React automatically. There is no HTML parsing path. _(Req 5.1, 9)_
 */

import { Fragment, type ReactNode } from 'react';

/** Props for {@link Markdown}. */
export interface MarkdownProps {
  /** The raw markdown source to render. */
  source: string;
  /** Optional class applied to the wrapping container. */
  className?: string;
}

/** Only these URL schemes are allowed for links; everything else is inert. */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/**
 * Only these sources are allowed for images: inline `data:image/*` payloads
 * (how pasted images are embedded) and remote http(s) URLs. Any other scheme
 * (e.g. `javascript:`, `file:`) renders as plain text instead of an <img>.
 */
const SAFE_IMAGE_SRC = /^(data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml);base64,|https?:\/\/)/i;

/**
 * Renders a markdown source string as a safe React element tree.
 */
export function Markdown({ source, className }: MarkdownProps) {
  const blocks = parseBlocks(source ?? '');
  return <div className={className}>{blocks}</div>;
}

/**
 * Render an image node from a markdown `![alt](src)` match. When `src` is not
 * an allowed source, the original markdown text is returned verbatim so nothing
 * unsafe is ever emitted as an `<img>`.
 *
 * The `block` flag selects layout: block images stand alone with vertical
 * margin; inline images flow with surrounding text.
 */
function renderImage(alt: string, src: string, key: number, block: boolean): ReactNode {
  if (!SAFE_IMAGE_SRC.test(src)) {
    return <Fragment key={key}>{`![${alt}](${src})`}</Fragment>;
  }
  const layout = block
    ? 'my-2 block object-contain'
    : 'my-1 inline-block object-contain align-middle';
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={key}
      src={src}
      alt={alt}
      className={`${layout} max-h-96 max-w-full rounded-md border border-border`}
    />
  );
}

/**
 * Parse the source into block-level React nodes (headings, lists, code blocks,
 * blockquotes, rules, and paragraphs), processing line-by-line.
 */
function parseBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: ``` ... ```
    if (/^```/.test(line.trim())) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // consume the closing fence (if present)
      out.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
        >
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Blank line: skip (paragraph separation is handled by grouping).
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={key++} className="my-3 border-border" />);
      i += 1;
      continue;
    }

    // Heading: #..###### followed by a space.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = parseInline(heading[2]);
      out.push(headingElement(level, content, key++));
      i += 1;
      continue;
    }

    // Standalone image on its own line -> block-level figure. Only emit the
    // block <img> when the source is allowed; otherwise fall through so the
    // line renders as literal text (paragraph) below.
    const blockImage = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (blockImage && SAFE_IMAGE_SRC.test(blockImage[2])) {
      out.push(renderImage(blockImage[1], blockImage[2], key++, true));
      i += 1;
      continue;
    }

    // Blockquote: one or more consecutive `> ` lines.
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(
        <blockquote
          key={key++}
          className="my-2 border-l-2 border-border pl-3 text-muted-foreground"
        >
          {parseInline(quote.join('\n'))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list: consecutive `- `, `* `, or `+ ` lines.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*+]\s+/, '');
        items.push(<li key={items.length}>{parseInline(text)}</li>);
        i += 1;
      }
      out.push(
        <ul key={key++} className="my-2 list-disc pl-5">
          {items}
        </ul>,
      );
      continue;
    }

    // Ordered list: consecutive `N. ` lines.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push(<li key={items.length}>{parseInline(text)}</li>);
        i += 1;
      }
      out.push(
        <ol key={key++} className="my-2 list-decimal pl-5">
          {items}
        </ol>,
      );
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-special lines. Soft line
    // breaks within a paragraph are preserved as <br />.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(
      <p key={key++} className="my-2 first:mt-0 last:mb-0">
        {withLineBreaks(para)}
      </p>,
    );
  }

  return out;
}

/** Build the correct heading element for a level (1..6). */
function headingElement(level: number, content: ReactNode, key: number): ReactNode {
  const cls = 'font-semibold text-foreground';
  switch (level) {
    case 1:
      return <h1 key={key} className={`${cls} mt-3 mb-1 text-lg`}>{content}</h1>;
    case 2:
      return <h2 key={key} className={`${cls} mt-3 mb-1 text-base`}>{content}</h2>;
    case 3:
      return <h3 key={key} className={`${cls} mt-2 mb-1 text-sm`}>{content}</h3>;
    default:
      return <h4 key={key} className={`${cls} mt-2 mb-1 text-sm`}>{content}</h4>;
  }
}

/** Join paragraph lines, inserting <br /> for the soft breaks between them. */
function withLineBreaks(lines: string[]): ReactNode {
  const parts: ReactNode[] = [];
  lines.forEach((ln, idx) => {
    if (idx > 0) {
      parts.push(<br key={`br-${idx}`} />);
    }
    parts.push(<Fragment key={`ln-${idx}`}>{parseInline(ln)}</Fragment>);
  });
  return parts;
}

/**
 * Parse inline markdown (bold, italic, inline code, links) into React nodes.
 * Implemented as a single left-to-right scan so tokens never overlap.
 */
function parseInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;

  // Ordered by precedence; `code` is matched first so its contents are literal.
  const patterns: Array<{
    re: RegExp;
    render: (m: RegExpExecArray, k: number) => ReactNode;
  }> = [
    {
      re: /`([^`]+)`/,
      render: (m, k) => (
        <code key={k} className="rounded bg-muted px-1 py-0.5 text-xs">
          {m[1]}
        </code>
      ),
    },
    {
      // Inline image: `![alt](src)`. Matched before links so the leading `!`
      // is not swallowed by the link pattern.
      re: /!\[([^\]]*)\]\(([^)\s]+)\)/,
      render: (m, k) => renderImage(m[1], m[2], k, false),
    },
    {
      re: /\*\*([^*]+)\*\*/,
      render: (m, k) => <strong key={k}>{parseInline(m[1])}</strong>,
    },
    {
      re: /(?:\*([^*]+)\*|_([^_]+)_)/,
      render: (m, k) => <em key={k}>{parseInline(m[1] ?? m[2] ?? '')}</em>,
    },
    {
      re: /\[([^\]]+)\]\(([^)\s]+)\)/,
      render: (m, k) => {
        const href = m[2];
        const label = m[1];
        if (!SAFE_LINK.test(href)) {
          // Disallowed scheme: render the original markdown as plain text.
          return <Fragment key={k}>{`[${label}](${href})`}</Fragment>;
        }
        return (
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {label}
          </a>
        );
      },
    },
  ];

  // Repeatedly find the earliest-matching pattern and split around it.
  // Guard against pathological inputs with a generous iteration cap.
  let guard = 0;
  while (rest.length > 0 && guard < 10000) {
    guard += 1;
    let best: { index: number; length: number; node: ReactNode } | null = null;

    for (const { re, render } of patterns) {
      const m = re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, node: render(m, key++) };
      }
    }

    if (best === null) {
      nodes.push(<Fragment key={key++}>{rest}</Fragment>);
      break;
    }

    if (best.index > 0) {
      nodes.push(<Fragment key={key++}>{rest.slice(0, best.index)}</Fragment>);
    }
    nodes.push(best.node);
    rest = rest.slice(best.index + best.length);
  }

  return nodes;
}
