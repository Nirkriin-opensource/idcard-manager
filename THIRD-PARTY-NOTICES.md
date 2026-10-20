# Third-party components

Dependencies are pinned by `package-lock.json`. Preserve each dependency's LICENSE/NOTICE when distributing the installed application. This index is not a substitute for the individual license text and bundled native-library notices.

| Component | Declared license / notices |
|---|---|
| Node.js | MIT and bundled third-party notices |
| Next.js, React, Konva, react-konva | MIT |
| pg, pg-boss, Zod, node-argon2 | MIT; native Argon2 notices also apply |
| sharp | Apache-2.0; libvips and other bundled native-library licenses/notices also apply |
| fontkit | MIT; font metadata and Unicode coverage. Synced/uploaded fonts retain their own licenses and are not bundled in the source archive. |
| ExcelJS, csv-parse, yauzl | MIT; dependency notices also apply |
| bwip-js / BWIPP | MIT; preserve included component and font license notices |
| PostgreSQL | PostgreSQL License |
| Caddy | Apache-2.0 |
| DejaVu / Noto fonts installed through apt | Font-specific licenses from Ubuntu packages; not copied into this source archive |
| Playwright (test tool) | Apache-2.0 |
| JSFeat / frontal-face cascade | MIT; attribution and license in docs/third-party |
| zxing-wasm (test tool) | MIT wrapper; ZXing-C++ Apache-2.0 and bundled BSD-3-Clause notices |
| jsQR, embedded-postgres (test tools) | MIT; embedded PostgreSQL binary notices also apply |

ExcelJS's UUID dependency is overridden to 11.1.1 to resolve an advisory; workbook read/write behavior is covered by tests. `skipLibCheck` handles upstream declaration incompatibilities; application source remains strictly type-checked. No commercial template-editor SDK is used.

PDFKit, archiver, tar and Leaflet use MIT licenses; preserve their packaged notices. PDF.js is Apache-2.0 and @napi-rs/canvas is MIT (test tools only). OpenStreetMap data is ODbL; interactive tiles show required attribution and are never batch-downloaded for print output. Uploaded map assets require suitable user rights.
