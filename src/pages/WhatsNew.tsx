import React from "react";
import changelogMd from "../../Details/CHANGELOG.md?raw";
import { GitCommitHorizontal, Tag } from "lucide-react";

interface ChangeItem {
  text: string;
  category: string; // e.g. "Added", "Fixed", "Changed"
}

interface ChangeEntry {
  version: string;
  date?: string;
  items: ChangeItem[];
}

/**
 * Minimal parser for Details/CHANGELOG.md: sections are `## ...` headers,
 * bullets are `- ...` lines, and `### ...` headers bucket the bullets.
 */
function parseChangelog(md: string): ChangeEntry[] {
  const lines = md.split("\n");
  const entries: ChangeEntry[] = [];
  let current: ChangeEntry | null = null;
  let category = "Notes";

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      if (current) entries.push(current);
      const title = line.slice(3).trim();
      const dateMatch = title.match(/^\[.+\]\s*-\s*(.+)$/);
      current = {
        version: title,
        date: dateMatch ? dateMatch[1].trim() : undefined,
        items: [],
      };
      category = "Notes";
    } else if (line.startsWith("### ") && current) {
      category = line.slice(4).trim();
    } else if (line.startsWith("- ") && current) {
      current.items.push({ text: line.slice(2), category });
    }
  }
  if (current) entries.push(current);
  return entries.filter((e) => e.items.length > 0);
}

const entries = parseChangelog(changelogMd);

const categoryStyles: Record<string, string> = {
  Added: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  Fixed: "bg-rose-500/10 text-rose-300 border-rose-500/20",
  Changed: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  Notes: "bg-white/5 text-white/50 border-line",
};

export default function WhatsNew() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <div className="text-center max-w-2xl mx-auto">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-line bg-white/5 text-[10px] font-mono text-white/50 uppercase tracking-widest mb-6">
          <GitCommitHorizontal size={11} className="text-amber-400" />
          Changelog
        </span>
        <h1 className="text-3xl md:text-4xl font-light text-white tracking-tight">What&apos;s new in Collateral</h1>
        <p className="mt-4 text-white/55 text-sm leading-relaxed">
          Rendered straight from <code className="font-mono text-white/40 bg-white/5 px-1.5 py-0.5 rounded">Details/CHANGELOG.md</code> —
          newest work first.
        </p>
      </div>

      <div className="mt-14 relative border-l border-line pl-8 space-y-12">
        {entries.map((entry, idx) => (
          <div key={entry.version + idx} className="relative">
            <span className="absolute -left-[41px] top-0 w-5 h-5 rounded-full bg-surface border border-white/15 flex items-center justify-center">
              <Tag size={9} className="text-white/50" />
            </span>
            <h2 className="flex flex-wrap items-center gap-3 text-lg font-medium text-white tracking-tight">
              {entry.version}
              {entry.date && <span className="text-xs font-mono text-white/40 bg-white/5 border border-line px-2 py-1 rounded">{entry.date}</span>}
            </h2>
            <ul className="mt-5 flex flex-col gap-3">
              {entry.items.map((item, j) => (
                <li key={j} className="flex items-start gap-3 text-sm">
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                      categoryStyles[item.category] || categoryStyles.Notes
                    }`}
                  >
                    {item.category}
                  </span>
                  <span className="text-white/70 leading-relaxed break-words">{renderInline(item.text)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  // Very light inline renderer: **bold** and `code`
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="text-white font-medium">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="font-mono text-[11px] text-amber-200/90 bg-white/5 px-1 py-0.5 rounded">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}