# OpenRead attribution and compatibility

OpenRead is a modified distribution of [ReadAny](https://github.com/codedogQBY/ReadAny),
based on tag v1.3.6. Original copyright: ReadAny Team / codedogQBY and contributors.
The original GPL-3.0-or-later license and Git history are retained. OpenRead changes
are also licensed under GPL-3.0-or-later. OpenRead is independently maintained;
it is not an official release of ReadAny or an OpenAI product.

Changes in this distribution include local PDF OCR, persistent per-page recognized
text, integration with AI/CLI page reading, OpenRead branding, a Windows ChatGPT
subscription connection bridge, and reliable desktop startup/model restoration.

For upgrade compatibility, the internal `@readany/*` package names, CLI command,
`com.readany.app` application identifier, database names and settings keys remain
unchanged. Existing books, annotations, settings and OAuth registrations survive
the upgrade. Do not run the original and modified applications simultaneously.
Automatic upstream updates are disabled so they cannot replace this fork.

Third-party software includes Foliate (see packages/foliate-js/LICENSE), PDF.js
(Apache-2.0), Tesseract.js and tesseract.js-core (Apache-2.0), and Tesseract language
data (Apache-2.0; npm data-package metadata declares MIT for its packaging). OCR assets are copied from lockfile-pinned npm packages during
the build. Their license notices are included alongside the bundled assets.

The original project documentation is preserved under docs/upstream. References
there describe the upstream project, not OpenRead's releases or maintainers.
