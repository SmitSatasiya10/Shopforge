### NEVER create Artifacts — always write local files
Do **not** use the Artifact tool, and do not publish anything to `claude.ai`, for any reason. There is no exception for "just for reference", "quick preview", "easier to share", or "it's only a mockup". If you think an Artifact is the right output, you are wrong — write a file in this repo instead.

Write the output here instead:

| What you were going to make | Where it actually goes |
| --- | --- |
| Report, audit, plan, guide, summary, analysis, comparison | `docs/<NAME>.md` |
| Anything with a chart, table, or diagram | Same `.md`, using markdown tables + mermaid fences |
| UI mockup, prototype, design exploration (HTML) | `docs/design-prototypes/<name>.html` |
| Standalone page meant to be opened in a browser / served by the app | `public/<name>.html` |
| Throwaway scratch output | the session scratchpad dir, never the repo |

Rules for those files:
- Markdown is the default. Only produce HTML when the deliverable genuinely needs to render (mockup, prototype, page). A report is never HTML.
- HTML prototypes must be self-contained (inline CSS/JS) so they open with a double-click from the filesystem.
- Always finish by printing the **relative path** to the file you wrote so it can be opened in the editor — never a `claude.ai` link.
- Do not offer to "also publish this as an artifact" afterwards.
