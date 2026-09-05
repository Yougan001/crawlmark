export const sampleInput = {
  url: 'https://sample.example.com/field-guide',
  status: 200,
  mode: 'sample',
  headers: { 'x-robots-tag': ['noindex'] },
  robots: { status: 200, text: 'User-agent: *\nAllow: /\n' },
  html: `<!doctype html>
<html lang="en">
<head>
  <title>A field guide to better release notes</title>
  <meta name="description" content="A practical guide to explaining changes, migrations and known limitations.">
  <link rel="canonical" href="/field-guide">
</head>
<body>
  <main>
    <h1>A field guide to better release notes</h1>
    <p>Release notes should help the reader decide whether to update, what to test and what changed for them.</p>
    <h3>Write for the person upgrading</h3>
    <p>Start with the visible change. Separate new behavior from fixes, and put migration steps next to breaking changes.</p>
    <img src="release-outline.png">
    <h2>Leave a clear route back</h2>
    <p>Link to the previous version and document known limitations. A short, useful note beats a long list of internal tasks.</p>
  </main>
</body>
</html>`,
};
