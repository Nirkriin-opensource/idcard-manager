# Printing languages and PC fonts

Open **Organization → Appearance & card themes → Card printing languages & PC fonts**. English is the default primary language. Select another primary language or an additional language, choose fonts, then save appearance defaults. These settings apply to newly generated cards; existing card images stay unchanged. Text is printed as entered, without automatic translation.

The selector includes English, Tamil, Hindi, Telugu, Malayalam, Kannada, Bengali, Marathi, Gujarati, Punjabi, Odia, Sinhala, Nepali, Arabic, Urdu, Hebrew, Thai, Chinese, Japanese, Korean, French, German and Spanish. The renderer checks installed font coverage and uses Pango shaping for complex scripts. Missing characters and overflowing text stop printing with guidance.

A signed-in Super Admin can use **Sync fonts from PC** on Windows or Ubuntu WSL. WSL reads known Windows font directories under `/mnt/c`, copies TTF/OTF/TTC files into private application storage and indexes the families. It does not change Windows settings. On a remote server, use **Upload font file** instead. Upload fonts you are entitled to use. Native Linux fonts are also available. Font files and the catalog are included in storage backups.

In the designer, select a text field, then choose **Text language** and **Font**. An explicit field font overrides the theme. Fields marked with the additional language use its chosen font. Browser support for TTC files varies; inspect **Authoritative render preview** for final shaping and positioning before printing.

New batches freeze font-family identifiers alongside theme and field-policy settings. Managed font files are content-addressed and are not overwritten. Do not delete font storage used by queued jobs. Existing card PNGs are retained.

Font APIs require authentication. Upload and PC sync require a session Super Admin, organization admin context, CSRF protection and an audit entry. Requests never supply arbitrary server file paths. The `sync-fonts` CLI command supports initial native setup when run as the service user with its normal environment loaded.
