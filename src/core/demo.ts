import { randomUUID } from "node:crypto";
import { transaction } from "./db.ts";
import { templateSchema, elementSchema } from "./template.ts";
export async function demo() {
  await transaction(async (c) => {
    const existing = await c.query(
      "SELECT id FROM organizations WHERE code='DEMO'",
    );
    if (existing.rowCount) {
      console.log("Demo organization already exists; no records changed.");
      return;
    }
    const org = randomUUID();
    await c.query(
      "INSERT INTO organizations(id,name,code) VALUES($1,'Demo organization','DEMO')",
      [org],
    );
    await c.query("SELECT set_config('app.org_id',$1,true)", [org]);
    await c.query(
      "INSERT INTO number_sequences(organization_id,prefix) VALUES($1,'DEMO')",
      [org],
    );
    for (let i = 1; i <= 10; i++)
      await c.query(
        "INSERT INTO people(id,organization_id,external_id,name,designation) VALUES($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          org,
          `DEMO${String(i).padStart(3, "0")}`,
          `Sample Person ${i}`,
          "Team member",
        ],
      );
    const template = randomUUID();
    await c.query(
      "INSERT INTO templates(id,organization_id,name,is_default) VALUES($1,$2,'Demo CR80',true)",
      [template, org],
    );
    const element = (values: Record<string, unknown>) =>
      elementSchema.parse({
        id: randomUUID(),
        x: 5,
        y: 5,
        width: 70,
        height: 10,
        ...values,
      });
    const doc = templateSchema.parse({
      schemaVersion: 1,
      width: 85.6,
      height: 53.98,
      front: [
        element({
          type: "rect",
          x: 0,
          y: 0,
          width: 85.6,
          height: 14,
          fill: "#076b70",
        }),
        element({
          type: "text",
          text: "DEMO ORGANIZATION",
          fontSize: 4,
          fill: "#ffffff",
        }),
        element({
          type: "text",
          text: "{{name}}",
          y: 19,
          fontSize: 4.5,
          width: 55,
          height: 14,
        }),
        element({
          type: "text",
          text: "{{external_id}}",
          y: 36,
          fontSize: 3.2,
          width: 50,
        }),
        element({
          type: "qr",
          x: 62,
          y: 28,
          width: 18,
          height: 18,
          text: "{{card.verify_url}}",
        }),
      ],
      back: [],
    });
    await c.query(
      "INSERT INTO template_versions(id,organization_id,template_id,version,document) VALUES($1,$2,$3,1,$4)",
      [randomUUID(), org, template, JSON.stringify(doc)],
    );
    console.log(
      "Created optional DEMO organization with 10 sample people and a template.",
    );
  });
}
