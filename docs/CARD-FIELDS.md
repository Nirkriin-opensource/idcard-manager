# Card types and manual mandatory fields

Open **Organization → Card fields & mandatory rules**. Choose Faculty / Staff, Student, Temporary / Visitor, or Working Professional. Every field in these four lists is available. Check **Show on card** and **Mandatory** independently; marking a field mandatory also selects it for printing. Name and ID are always mandatory because the database needs an identifiable, unique record. Other requirements are chosen manually, including visitor photos. Save each type separately.

Use **Save & create card template** to create a new editable preset with the chosen fields and requirements. Existing designs and generated cards are retained. Full-field presets use 85.6 × 110 mm front and back layouts so detailed fields remain legible. Open Templates to edit dimensions and positions and preview actual data before printing. Changing dimensions does not automatically reflow elements. Long values that exceed their boxes cause an overflow error; enlarge the box or adjust the layout.

The designer's **Mandatory fields for this template** panel can add stricter requirements to individual templates. Current organization requirements also apply. Removing a field or its binding from a design does not bypass its mandatory rule: generation reports the missing field. Download the upload kit from the saved template's mandatory panel to include both its extra requirements and current organization rules. Save design changes before downloading.

## People and uploads

After saving card field choices, the person editor offers the configured card types, relevant custom fields, and cardholder signature upload. Core contact, designation, name and ID fields stay in their existing columns. Optional professional email and registration number can remain optional. Dates use YYYY-MM-DD. Visitor valid-until values use an ISO date/time with timezone, such as `2026-10-18T17:00:00+05:30`. Time in / time out are recorded as text. RFID identifiers can be stored and printed; writing RFID chips needs compatible hardware and is not part of this software.

Download a type-specific upload kit from Organization or Imports. It contains:

- `people-upload-template.csv`: selected data columns plus `custom.card_type`; fill the blank first data row and copy the card type to every subsequent row.
- `card-field-requirements.csv`: printed/mandatory choices and the stage that checks each field.
- `photo-filename-guide.csv`: existing people of the chosen type and their expected portrait filenames. Download again after importing new people.
- Instructions for importing, assigning photos and signatures, and date formatting.

People saves and import validation enforce the card type's mandatory data fields. Commit checks current rules again, so changing rules after validation cannot commit incomplete rows. Template-specific extra rules are checked at card generation; the template's kit identifies these extra requirements. Images are assigned after people import and are checked during generation. Shared organization logo and authorized signature are uploaded/selected per card type. Cardholder signatures are uploaded per person or referenced by an existing asset ID from the same organization. Empty optional images are omitted from typed presets.

Cards must use a template matching the person's type. The chosen validity date controls actual expiry (end of that UTC day); visitor valid-until controls actual expiry including timezone. A separate expiry override must agree with the printed validity. General existing records and templates retain their previous behavior. Generated card snapshots and template version history remain immutable.

## API

`GET /api/orgs/:org/card-profiles` reads the organization's policies. Admin-only `PUT` saves `{kind,policy}`; `POST` also creates a fresh typed card template. A policy contains `shown`, `required`, and shared `assets` (`organization_logo`, `authorized_signature`). Asset IDs must belong to the organization. Card type values are `staff`, `student`, `visitor`, `professional`.

`GET /api/orgs/:org/upload-templates?kind=people|photos|kit|requirements&profile=staff` downloads current profile templates. Replace `profile` with `template_id=<uuid>` for a saved template's requirements. Downloads require people-management permission and use private, no-store responses. Profile downloads require saved configuration. Custom fields use existing organization-scoped storage and validation; no person data is rewritten when enabling profiles.
