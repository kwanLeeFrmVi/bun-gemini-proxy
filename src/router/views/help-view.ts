import { logger } from "../../observability/logger.ts";
import { errorResponse } from "../responses.ts";

/**
 * HelpView renders the user guide page from MDX documentation.
 * Responsible for loading, compiling, and converting MDX to HTML.
 */
export class HelpView {
  /**
   * Render the help page with user guide content.
   */
  async render(): Promise<Response> {
    try {
      const mdxPath = new URL("../../../docs/user-guide.mdx", import.meta.url).pathname;
      const mdxContent = await Bun.file(mdxPath).text();

      // Compile MDX to validate syntax (optional)
      const { compile } = await import("@mdx-js/mdx");
      await compile(mdxContent, {
        outputFormat: "program",
        development: false,
      });

      // Convert to HTML for rendering
      const htmlContent = this.mdxToHtml(mdxContent);

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemini Proxy - User Guide</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 { color: #2563eb; font-size: 2.5em; margin-bottom: 0.5em; border-bottom: 3px solid #2563eb; padding-bottom: 10px; }
    h2 { color: #1e40af; font-size: 1.8em; margin-top: 1.5em; margin-bottom: 0.5em; }
    h3 { color: #1e3a8a; font-size: 1.3em; margin-top: 1.2em; margin-bottom: 0.4em; }
    h4 { color: #1e293b; font-size: 1.1em; margin-top: 1em; margin-bottom: 0.3em; }
    p { margin-bottom: 1em; }
    code {
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 0.9em;
      color: #dc2626;
    }
    pre {
      background: #1e293b;
      color: #e2e8f0;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1em 0;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 0.85em;
      line-height: 1.5;
    }
    pre code {
      background: none;
      color: inherit;
      padding: 0;
      font-size: inherit;
    }
    ul, ol { margin-left: 2em; margin-bottom: 1em; }
    li { margin-bottom: 0.5em; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    strong { color: #1e293b; font-weight: 600; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 2em 0; }
    .back-link {
      display: inline-block;
      margin-bottom: 20px;
      padding: 8px 16px;
      background: #2563eb;
      color: white;
      border-radius: 4px;
      text-decoration: none;
    }
    .back-link:hover { background: #1e40af; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back-link">← Back to API</a>
    ${htmlContent}
  </div>
</body>
</html>`;

      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      logger.error({ error }, "Failed to load help page");
      return errorResponse("Help page not available", 500, "internal_error");
    }
  }

  /**
   * Convert MDX markdown to HTML.
   * Simple conversion without external dependencies.
   */
  private mdxToHtml(mdx: string): string {
    let html = mdx
      // Headers
      .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      // Code blocks
      .replace(/```(\w+)?\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Line breaks
      .replace(/\n\n/g, "</p><p>")
      // Horizontal rules
      .replace(/^---$/gm, "<hr>");

    return `<p>${html}</p>`.replace(/<\/p><p><h/g, "</p><h").replace(/<\/h(\d)><\/p>/g, "</h$1>");
  }
}
