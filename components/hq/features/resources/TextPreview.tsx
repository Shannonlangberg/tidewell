import { CopyButton } from "./CopyButton";

/*
 * A small text file shown as text: a code block with a copy button. React escapes everything, so nothing in a
 * file can run or style the page; an HTML file is shown as its source, never rendered. Server-rendered; only
 * the copy button is a client component.
 */

export function TextPreview({ text, label, truncated }: { text: string; label: string; truncated?: boolean }) {
  return (
    <div className="hq-res-code">
      <div className="hq-res-code__bar">
        <span className="hq-res-code__label">{label}</span>
        <CopyButton text={text} label="Copy text" done="Copied the text" size="sm" ariaLabel={`Copy the text of ${label}`} />
      </div>
      <pre className="hq-res-code__pre" tabIndex={0} aria-label={`Text of ${label}`}>
        <code>{text}</code>
      </pre>
      {truncated ? <p className="hq-res-code__more">Only the start is shown. Download the file for all of it.</p> : null}
    </div>
  );
}
