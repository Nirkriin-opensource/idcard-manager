# Application branding, themes and card styles

## Manual application logo

A Super Admin can open **Organization → Appearance & card themes → Application name & logo (all organizations)** and upload a PNG, JPEG or WebP image, change the application name, or reset the logo. The uploaded image appears on the sign-in page and sidebar. It is public application branding. Other images remain organization-scoped; the public branding endpoint serves only the explicitly uploaded application logo. Changing it does not replace card logos or historical card images.

Card logos and authorized signatures remain under **Card fields & mandatory rules**. Cardholder signatures remain in the person editor. The existing template designer also supports image uploads, colour controls, field dragging and authoritative front/back previews.

## Dashboard switcher

The **Organization → Display preferences → App theme** dropdown includes Paper, Night, Forest, Plum, Slate and CardDesk, plus the organization's custom themes. A personal choice is remembered in the browser separately for each organization. The admin's dashboard default applies when no personal choice is saved. The five original themes retain their existing colours and layouts. CardDesk adds the supplied HTML reference's blue/white styling, compact sidebar, rounded panels and smaller headings. Its dashboard font uses Plus Jakarta Sans when installed, otherwise Segoe UI or Arial; no remote font request is required. Colours and fonts apply to the dashboard; Forest uses green card accents and Plum uses purple. Night uses a dark dashboard and a print-friendly white card with navy accents.

Admins manage organization defaults in **Organization → Appearance & card themes**. Classic, Vertical and Modern card presets work with Staff, Student, Visitor and Professional profiles. Both sides follow the preset and theme. Existing saved card images are immutable. Full-field layouts use 85.6 × 110 mm (Classic/Modern) or 85.6 × 140 mm (Vertical); review size and real data in the designer before physical printing. Templates with no card type retain their existing saved design colours.

Choose a default template for each card type. Creating a themed preset can make it that type's default. **Set default** on a typed template also updates its per-type default; this action requires an organization administrator. Archiving a default clears that reference. Individual card generation selects the person's type default, and the batch screen offers a card-type selector with its default template. API callers may omit a template ID when a type default exists.

## Custom themes without code

Expand **Custom institution theme**, start from a built-in or existing theme, and set a unique key and display name. Theme settings include dashboard colours, card colours, a bundled font, left/right logo position and visible fields for each card type. Save the theme to make it available in the switcher. Mandatory fields are retained even when a theme's field list omits them. The designer keeps all editable fields; the authoritative preview and card generator apply the theme's field visibility.

Colour settings show measured text contrast. The server rejects custom palettes below 4.5:1 for dashboard text, secondary text, links, card text or white text on the card heading. Primary-button foreground switches to dark text when needed. QR and barcode areas stay black on white. These checks cover configured colours; uploaded artwork and physical printer results still need visual review.

## Locking and queued batches

Enable **Lock card colours for this organization**, choose the locked theme and save. Dashboard users can still change their personal dashboard theme, while new cards use the locked card theme. With the lock off, a newly generated typed card follows the user's selected dashboard theme (or the organization default for API requests without a choice).

Every queued batch freezes its effective theme settings, template version, organization name and card-field policy, including shared logo/signature asset IDs. Changes to dashboard colours, custom themes or mandatory rules after enqueue do not change that batch. Retries and worker restarts retain the same snapshot. Generated cards save the final document and theme alongside their existing frozen render. Old queued jobs receive a theme snapshot when first processed after upgrade.

## API

- Public `GET /api/branding` returns the application name and selected logo URL. Public `GET /api/branding/logo` serves only that image. Session-based Super Admin `POST /api/branding?org=<uuid>&name=<name>` uploads a raw image; `PUT` accepts `{name,resetLogo?}`. Writes use existing CSRF/origin protections and create an audit entry.
- `GET /api/orgs/:org/appearance` reads settings. Admin-only `PUT` saves `defaultTheme`, `locked`, `lockedTheme`, `customThemes` and per-type template `defaults`. Built-in themes cannot be overwritten, and cross-organization or wrong-type defaults are rejected.
- Admin-only `POST /api/orgs/:org/appearance` creates `{kind,layout,theme?}` presets. Kinds are `staff`, `student`, `visitor`, `professional`; layouts are `classic`, `vertical`, `modern`.
- Individual cards, batch generation and preview requests accept optional `theme_key`. A lock overrides this value. Batch filters accept `card_type`. Individual/batch template IDs can be omitted when a corresponding type default is configured.

Migration `005_appearance.sql` adds organization appearance settings, queued style snapshots and the explicit global branding reference. Previous migrations and stored cards are retained.

## Sidebar navigation

Pages are grouped into Overview, People, Cards & printing, Administration and Getting started. Choose **Arrange menu** to move groups or pages using the arrow buttons; choose **Reset menu** to restore the default order. Ordering is remembered for the signed-in user on this device. Permissions still determine which pages are visible. On phones, use **Open menu** to navigate; selecting a page closes the menu.

## Automatic photo fitting

In the template designer, photos use **Auto fill frame (crop edges)** by default. They keep their proportions and crop centrally to the frame, including square frames. Choose **Square photo** to make the selected photo frame square, or **Fit whole image** to show the entire photo with transparent space around it. The editor preview follows the same fitting rule as printing. Upload originals remain unchanged; previously rendered cards retain their saved images.

## One import kit for every card type

Open **Imports → Download complete import kit (ZIP)**. The kit contains one `people-upload-template.csv` covering Staff, Student, Visitor and Professional fields, a requirements guide for all four types, photo filename guidance and instructions. Fill `custom.card_type` on every row (`staff`, `student`, `visitor` or `professional`) and leave unrelated fields blank. Configure each used card type in Organization first. Organization custom fields are included too.

Upload the filled CSV or XLSX and review **Map your columns**. Recognized field keys and labels match automatically; you can change matches or ignore columns. Card-type names such as Student and Working Professional are accepted and stored consistently. Validate before committing; each row follows its own card type's mandatory rules. Upload portraits under Photos using the person's external ID as the filename. Upload signature images in the app; do not put local file paths in signature cells.

## One shared card template

Organization → Appearance & card themes now offers **Create / update shared template**, replacing the separate layout choices for new templates. One template contains Staff, Student, Visitor and Professional designs. Keep **Use this shared template by default for all card types** selected to use that same template automatically for everyone.

In Templates, open **Shared card template**. Use **Editing card type** to edit each design's front and back, fields, dimensions, photos, signatures and codes. **Save version** saves all four designs together. Each person's Card type selects the correct design during preview and generation. Mixed batches can use this one template; required fields, organization images, visitor expiry, themes, language and font settings remain specific to each card type or organization. Template versions, queued batches and saved renders preserve their original designs and settings.

Creating again rebuilds the four layouts from the current field rules and theme as a new version of the existing shared template. Existing templates remain usable. Previously saved card renders stay unchanged. Printing uses each generated card's saved dimensions; export differing physical sizes separately.

## General is the single card type

New workflows use one **General** card type. In **Organization → Card fields & mandatory rules**, every supported field is in one list. Select **Show on card** and **Mandatory**, then **Save field choices**. Name and ID remain mandatory. There are no Staff, Student, Visitor or Professional category choices in the new workflow.

Choose **Create / update General template** in Appearance & card themes. This creates one editable front/back design from the General rules and can be the default for everyone. Updating a former shared template saves a new General version of the same template. Existing saved card images and historical versions remain intact.

New records and imports use General automatically once General rules or the General template are configured. The General import kit includes all available fields without requiring a card-type column. Photos, signatures, organization images, languages, fonts, themes, codes and printing options remain available. If many fields are selected, the preset grows vertically to fit them; review the actual card size in the designer before printing.
